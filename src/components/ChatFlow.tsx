import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  Edge,
  Node,
  useReactFlow,
  useStoreApi,
  applyNodeChanges,
  NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import SystemNode from './nodes/SystemNode';
import ChatNode from './nodes/ChatNode';
import SessionStats from './SessionStats';
import { useSessionStore } from '../stores/sessionStore';
import { useModelStore } from '../stores/modelStore';
import { useThemeStore } from '../stores/themeStore';
import { ChatNode as ChatNodeType, NodeData, UsageStats } from '../types';
import { useT } from '../i18n';
import { sendChatRequest } from '../services/apiService';
import { Share2, LayoutGrid, FileJson, BarChart3 } from 'lucide-react';
import { exportToMindmap } from '../utils/exportUtils';
import { exportSessionToFile } from '../utils/sessionTransfer';
import { showSuccess, showError, showInfo } from '../utils/notification';
import { deriveSessionTitle } from '../utils/sessionTitle';

/*
 * 画布布局常量。
 *
 * 宽度必须和 index.css 里 .node-content 的 width（644px）保持一致，
 * 否则子树宽度会算得比实际窄，兄弟节点互相重叠。
 * 高度没法预先知道（回答长短不一），420 只是估值 —— 真实尺寸由
 * collectNodeDimensions 从 React Flow 量到后覆盖。
 *
 * 这几个值必须放模块级：建图有两条路径（calculateNodeLayout 和下面那个
 * 渲染 useEffect），放函数里就没法共用了。
 */
const NODE_WIDTH = 644;
const NODE_HEIGHT = 420;
const H_GAP = 220;
const V_GAP = 140;

/*
 * 跨会话保留的视口（平移 + 缩放），**按会话分开存**。
 *
 * 切换会话时 ReactFlowWrapper 会被 key 重建，视口会重置回 defaultViewport。
 * 三个理由让它必须 per-session、而且必须连平移一起记：
 *   1) 只记缩放、切回来平移归零时，节点若长在离原点很远处，屏幕就是一片空白；
 *   2) 每个会话的树形状不同，A 图的视角对 B 图没意义；
 *   3) 刷新页面后还得在（用户反馈「一刷新就没了」），所以落 localStorage。
 * 用模块级 Map 当内存缓存（不是组件 state —— 重建后 state 也没了）。
 */
type SavedViewport = { x: number; y: number; zoom: number };

const VIEWPORT_STORAGE_KEY = 'treeai-viewports';
// 最多记这么多个会话，超了就丢最久没碰过的。Map 的插入顺序就是最近使用顺序。
const VIEWPORT_LIMIT = 80;

function readStoredViewports(): [string, SavedViewport][] {
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.entries(parsed as Record<string, SavedViewport>).filter(
      ([, v]) =>
        !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number'
    );
  } catch {
    // 存的东西坏了 / 无痕模式读不到：当作没存过，别让整页挂掉
    return [];
  }
}

const savedViewports = new Map<string, SavedViewport>(readStoredViewports());

// 平移时每一帧都会喊一次，攒一攒再落盘，不然每帧都要 stringify 整张表
let viewportFlushHandle: number | null = null;

function rememberViewport(sessionId: string, viewport: SavedViewport) {
  // 先删再塞，把这一项挪到 Map 末尾 —— 等于盖一个「刚刚用过」的戳
  savedViewports.delete(sessionId);
  savedViewports.set(sessionId, viewport);
  while (savedViewports.size > VIEWPORT_LIMIT) {
    const oldest = savedViewports.keys().next().value;
    if (oldest === undefined) break;
    savedViewports.delete(oldest);
  }
  if (viewportFlushHandle !== null) return;
  viewportFlushHandle = window.setTimeout(() => {
    viewportFlushHandle = null;
    try {
      localStorage.setItem(
        VIEWPORT_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(savedViewports))
      );
    } catch {
      // 配额满 / 无痕模式：落盘失败不影响本次使用
    }
  }, 300);
}

/*
 * 首次进入某个会话（还没存过视口）时的落点。
 *
 * 直接把世界坐标 x = 0 对到画板中点是不够的：新建会话时根节点存的位置是
 * {0, 0}，而走 calculateNodeLayout 排过的树又会被摆在 -rootWidth / 2，两种世界的
 * 原点并不都落在中线上。所以这里直接量**内容包围盒**，把它的中心对到画板水平
 * 中点 —— 布局本身关于根节点中线是对称的，因此「包围盒中心」就是那条中线。
 *
 * y 用 HOME_TOP_MARGIN - minY：不管是 0 还是排过（正数）的起点，最上面那个
 * 节点离画板顶都是这个边距，不会顶到天花板。
 */
const HOME_TOP_MARGIN = 56;

function homeViewport(paneWidth: number, nodes: ChatNodeType[]): SavedViewport {
  // 空会话也别等到节点到位再算：新建的会话马上会被自动补一个根节点，
  // 而它没有 position（resolveNodePosition 会退回 {0,0}），所以先按「原点上一个
  // 根节点」估。这样首帧和节点到位后是同一个视角，不会跳。
  let minX = 0;
  let maxX = NODE_WIDTH;
  let minY = 0;

  if (nodes.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    nodes.forEach(node => {
      const p = node.position ?? resolveNodePosition(node, nodes);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + NODE_WIDTH);
      minY = Math.min(minY, p.y);
    });
  }

  return {
    x: paneWidth / 2 - (minX + maxX) / 2,
    y: HOME_TOP_MARGIN - minY,
    zoom: 1,
  };
}

/**
 * 节点的有效坐标。
 *
 * 有保存的位置就用保存的；没有就退回「父节点正下方」（根节点是原点）。
 * 建图的渲染路径和新节点的落点计算都走这一个函数，两边才不会打架。
 *
 * 两点是刻意的：
 *   - 只用常量算，不用实测尺寸。否则节点一边流式输出一边长高，坐标会跟着跳。
 *   - 只往上看一层，不递归。导入文件理论上能造出 parentId 环，递归会爆栈。
 */
function resolveNodePosition(
  node: ChatNodeType,
  all: ChatNodeType[]
): { x: number; y: number } {
  if (node.position) return node.position;
  if (!node.parentId) return { x: 0, y: 0 };
  const parent = all.find(n => n.id === node.parentId);
  const base = parent?.position ?? { x: 0, y: 0 };
  return { x: base.x, y: base.y + NODE_HEIGHT + V_GAP };
}

/**
 * 组装一个 React Flow 节点对象。
 *
 * `previous` 必须摊在最前面 —— 这里不能用「重建一个干净对象」的写法。
 * React Flow 会把量到的 width/height 写回我们传进去的节点对象（applyChanges 的
 * dimensions 分支），而它判断「这条边能不能画」的依据就是 node.width && node.height
 * （源码 getNodeData 里的 isValid）。重建时把这两个字段丢掉，边会直接 return null
 * 不渲染 —— 直到下一次重新测量（拖动节点、点击）把尺寸写回来，连线才突然出现。
 * 这就是「新加的节点连线不完整，点一下或挪一下才出来」的原因。
 */
function buildFlowNode(
  node: ChatNodeType,
  position: { x: number; y: number },
  data: NodeData,
  previous?: Node
): Node {
  return {
    ...previous,
    id: node.id,
    type: node.type,
    position,
    data,
  };
}

function buildFlowEdges(nodes: ChatNodeType[]): Edge[] {
  return nodes
    .filter(node => node.parentId)
    .map(node => ({
      id: `e-${node.parentId}-${node.id}`,
      source: node.parentId!,
      target: node.id,
      type: 'smoothstep',
      animated: false,
    }));
}

const nodeTypes = {
  system: SystemNode,
  chat: ChatNode,
};

interface ChatFlowProps {
  sessionId: string;
}

const ReactFlowWrapper: React.FC<ChatFlowProps> = ({ sessionId }) => {
  const { sessions, addNodeToSession, updateNodeInSession, replaceSessionNodes, deleteNodeFromSession, autoTitleSession } = useSessionStore();
  const { models, defaultModelId } = useModelStore();
  const { theme } = useThemeStore();
  const session = sessions.find(s => s.id === sessionId);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const reactFlowInstance = useReactFlow();
  const t = useT();

  // 持续把当前视口同步到模块级 Map（按 sessionId 分开）。
  //
  // 不能用「卸载时读一次」：key 变化时 React 先 render 新实例（此时就会读
  // savedViewports）、再在 commit 阶段跑旧实例的 cleanup，顺序反了 ——
  // 新实例读到的还是旧值。
  // 也不能用 onMoveEnd：React Flow 对「内部」视口变更（Controls 的 +/- 按钮）
  // 带 sourceEvent.internal 直接 return，不会触发。
  //
  // 用 store.subscribe 而不是 useStore(selector)：后者会在平移的每一帧
  // 都触发整个 wrapper 重渲染，纯属浪费。
  const store = useStoreApi();
  useEffect(() => {
    const write = (s: { transform: [number, number, number] }) => {
      rememberViewport(sessionId, { x: s.transform[0], y: s.transform[1], zoom: s.transform[2] });
    };
    const unsub = store.subscribe(write);
    return unsub;
  }, [sessionId, store]);

  // 画板容器，用来量宽度、算「中线居中」的初始视口
  const paneRef = useRef<HTMLDivElement>(null);
  // 本次进入会话用的初始视口：存过就用存的；没存过就等量到容器宽度后再按内容包围盒算。
  // 算出来之前先不挂 <ReactFlow> —— defaultViewport 只在初始化那一刻读一次
  // （ZoomPane 里那个 useEffect 的依赖是 []），先用占位值挂上去的话会先按错的
  // 位置摆一帧，再跳一下。
  const [initialViewport, setInitialViewport] = useState<SavedViewport | undefined>(() =>
    savedViewports.get(sessionId)
  );

  useLayoutEffect(() => {
    if (initialViewport) return;
    const width = paneRef.current?.clientWidth || window.innerWidth / 2;
    setInitialViewport(homeViewport(width, session?.nodes ?? []));
  }, [initialViewport, session?.nodes]);
  const abortControllerRef = useRef<Record<string, AbortController>>({});
  const [nodeDimensions, setNodeDimensions] = useState<Record<string, { width: number, height: number }>>({});
  // 刚新建的节点 id。渲染完成后把它平移到视野中间，否则可能落在屏幕外面。
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);

  /*
   * 上一次交给 React Flow 的节点对象。两个用途：
   *   1) 原样复用没变化的节点，让 React Flow 跳过它的重渲染；
   *   2) 重建时把 React Flow 量出来的 width/height 带过去（详见 buildFlowNode）。
   *
   * ⚠️ 数据源必须是 `nodes` state，不能是我们传出去的那批对象。
   * React Flow 的 applyChanges 里是 `const updateItem = { ...item }`（拷贝），
   * 量到的尺寸只写回 state，我们传出去的对象永远没有 width/height。
   * 每次渲染从 state 同步一份，重建节点时才能把测量值带住 ——
   * 否则边会因为 getNodeData().isValid === false 而整条不渲染。
   */
  const flowNodesRef = useRef<Map<string, Node>>(new Map());
  flowNodesRef.current = new Map(nodes.map(n => [n.id, n]));
  // 当前 edges 的结构指纹，避免结构没变时反复 setEdges
  const edgeSignatureRef = useRef('');

  /**
   * 只有图的「形状」变了才更新 edges。
   * 流式输出时每来一个 token 都会走到提交这一步，无脑 setEdges 会让 React Flow
   * 反复重建全部边。
   */
  const commitEdges = useCallback((next: Edge[]) => {
    const signature = next.map(e => e.id).join('|');
    if (signature === edgeSignatureRef.current) return;
    edgeSignatureRef.current = signature;
    setEdges(next);
  }, []);
  const [streamingResponses, setStreamingResponses] = useState<Record<string, string>>({});
  // 思维链单独一个 map。它以独立通道（delta.reasoning_content）到达，
  // 而且整段都在正文之前，所以不会和正文的更新叠加成「每 chunk 两次重渲染」。
  const [streamingReasoning, setStreamingReasoning] = useState<Record<string, string>>({});

  // 流式状态清理：正文和思维链一起清，否则重试后会残留上一次的内容
  const clearStreamingState = useCallback((nodeId: string) => {
    setStreamingResponses(prev => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    setStreamingReasoning(prev => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  const calculateNodeLayout = useCallback((forceRecalculate = false) => {
    if (!session || !session.nodes) return;
  
    const getNodeDimensions = (nodeId: string) => {
      return nodeDimensions[nodeId] || { width: NODE_WIDTH, height: NODE_HEIGHT };
    };
    
    const nodeHeights = new Map<string, number>();
    session.nodes.forEach(node => {
      nodeHeights.set(node.id, getNodeDimensions(node.id).height);
    });
    
    const nodePositions = new Map<string, { x: number, y: number }>();
    const nodeMap = new Map<string, ChatNodeType>();
    
    session.nodes.forEach(node => {
      nodeMap.set(node.id, node);
    });
  
    const nodeLevels = new Map<string, number>();
    const determineLevel = (nodeId: string, level: number) => {
      nodeLevels.set(nodeId, level);
      
      const children = session.nodes.filter(n => n.parentId === nodeId);
      children.forEach(child => {
        determineLevel(child.id, level + 1);
      });
    };
  
    const systemNode = session.nodes.find(n => n.type === 'system');
    if (systemNode) {
      determineLevel(systemNode.id, 0);
    }
  
    const subtreeWidths = new Map<string, number>();
    const calculateSubtreeWidth = (nodeId: string): number => {
      const children = session.nodes.filter(n => n.parentId === nodeId);
      const nodeDim = getNodeDimensions(nodeId);
      
      if (children.length === 0) {
        subtreeWidths.set(nodeId, nodeDim.width);
        return nodeDim.width;
      }
      
      const childrenWidth = children.reduce((total, child, index) => {
        const width = calculateSubtreeWidth(child.id);
        return total + width + (index < children.length - 1 ? H_GAP : 0);
      }, 0);
      
      const subtreeWidth = Math.max(nodeDim.width, childrenWidth);
      subtreeWidths.set(nodeId, subtreeWidth);
      return subtreeWidth;
    };
  
    if (systemNode) {
      calculateSubtreeWidth(systemNode.id);
    }
  
    const calculateNodePosition = (nodeId: string, startX: number, level: number, startY: number) => {
      const nodeDim = getNodeDimensions(nodeId);
      const width = subtreeWidths.get(nodeId) || nodeDim.width;
      const height = nodeHeights.get(nodeId) || nodeDim.height;
      const x = startX + width / 2 - nodeDim.width / 2;
      const y = startY;
      
      nodePositions.set(nodeId, { x, y });
      
      const nextLevelY = y + height + V_GAP;
      
      const children = session.nodes.filter(n => n.parentId === nodeId);
      let childStartX = startX;
      
      children.forEach(child => {
        const childWidth = subtreeWidths.get(child.id) || getNodeDimensions(child.id).width;
        calculateNodePosition(child.id, childStartX, level + 1, nextLevelY);
        childStartX += childWidth + H_GAP;
      });
    };
  
    if (systemNode) {
      const rootWidth = subtreeWidths.get(systemNode.id) || getNodeDimensions(systemNode.id).width;
      calculateNodePosition(systemNode.id, -rootWidth / 2, 0, 0);
    }
  
    // 强制重排时，把新坐标先收集起来，最后一次性写回。
    // 不能在 .map 里逐个 updateNodeInSession —— 那是同步循环里连发 N 次异步
    // updateSession，会互相覆盖，只有最后一个节点的新坐标存得下来。
    const recalculatedPositions = new Map<string, { x: number; y: number }>();

    const reactFlowNodes = session.nodes.map(node => {
      // 强制重新布局 或 节点没有保存位置时，使用计算的位置
      let position: { x: number, y: number };
      if (!forceRecalculate && node.position) {
        position = node.position; // 保留原有位置
      } else {
        const calculatedPosition = nodePositions.get(node.id);
        position = calculatedPosition || { x: 0, y: 0 };

        if (forceRecalculate) {
          recalculatedPositions.set(node.id, position);
        }
      }

      return buildFlowNode(node, position, {
        ...nodeCallbacks,
        node,
        streamingResponse: streamingResponses[node.id] || null,
        streamingReasoning: streamingReasoning[node.id] || null,
        isRoot: node.type === 'system',
        autoFocus: pendingFocusId === node.id
      }, flowNodesRef.current.get(node.id));
    });

    // 一次写回全部新坐标（而不是循环 N 次），否则会丢更新。
    if (recalculatedPositions.size > 0) {
      replaceSessionNodes(
        sessionId,
        session.nodes.map(n =>
          recalculatedPositions.has(n.id)
            ? { ...n, position: recalculatedPositions.get(n.id)! }
            : n
        )
      );
    }

    setNodes(reactFlowNodes);
    commitEdges(buildFlowEdges(session.nodes));
  
    // 调整视图以显示所有节点
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2 });
    }, 50);
  
  // The handlers below intentionally read the latest session state from this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, nodeDimensions, streamingResponses, streamingReasoning, sessionId, replaceSessionNodes]);  


  /**
   * 计算新节点的落点。
   *
   * 原来写的是 `x: 父节点.x + 兄弟数 * 100, y: 父节点.y + 250`，两个问题：
   *   1) 节点宽 560px，兄弟之间只错开 100px —— 第二个子节点会压在第一个身上；
   *   2) 节点最高 760px（见 index.css 的 .node-content），只往下挪 250px，
   *      连第一个子节点都会和父节点重叠。
   * 这就是「聊完一轮，新节点位置很奇怪」的成因。
   *
   * 尺寸按实测值算（nodeDimensions 由 React Flow 量到），量不到才退回常量。
   *
   * 数据源用 session.nodes（落盘的那份），不用 React Flow 的 nodes state ——
   * 后者是异步重建的，刚删完节点时可能还带着影子，算出来的位置会莫名其妙。
   */
  const computeChildPosition = useCallback((parentId: string) => {
    const all = session?.nodes ?? [];
    const parent = all.find(n => n.id === parentId);
    if (!parent) return { x: 0, y: 0 };

    const sizeOf = (id: string) => nodeDimensions[id] || { width: NODE_WIDTH, height: NODE_HEIGHT };
    const parentPos = resolveNodePosition(parent, all);
    const parentSize = sizeOf(parentId);
    // 父节点水平中心减去自身一半宽 = 「居中在父节点正下方」
    const centeredX = parentPos.x + (parentSize.width - NODE_WIDTH) / 2;

    const siblings = all.filter(n => n.parentId === parentId);

    if (siblings.length === 0) {
      // 独子：居中在父节点正下方，垂直方向留出一整段间距
      return { x: centeredX, y: parentPos.y + parentSize.height + V_GAP };
    }

    // 已有分支：跟它们排在同一行。
    // 从左往右找第一个放得下的空位，而不是一律排在最右边 —— 否则
    // 「加一个、删掉、再加」会跳过那个空出来的位置，新节点一次比一次往右跑。
    const rowY = Math.min(...siblings.map(n => resolveNodePosition(n, all).y));
    const byX = [...siblings].sort(
      (a, b) => resolveNodePosition(a, all).x - resolveNodePosition(b, all).x
    );

    let x = centeredX;
    for (const sibling of byX) {
      const siblingPos = resolveNodePosition(sibling, all);
      if (x + NODE_WIDTH + H_GAP <= siblingPos.x) break; // 这个空位放得下
      x = Math.max(x, siblingPos.x + sizeOf(sibling.id).width + H_GAP);
    }
    return { x, y: rowY };
  }, [session, nodeDimensions]);

  const handleAddChildNode = (parentId: string) => {
    if (!session || !defaultModelId) return;
    
    const parentNode = session.nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    const newNode: ChatNodeType = {
      id: crypto.randomUUID(),
      parentId,
      type: 'chat',
      userMessage: "",
      assistantMessage: "",
      modelId: parentNode.modelId || defaultModelId,
      temperature: parentNode.temperature || 0.7,
      maxTokens: parentNode.maxTokens || 8192,
      createdAt: new Date().toISOString(),
      position: computeChildPosition(parentId)
    };

    addNodeToSession(sessionId, newNode);
    setPendingFocusId(newNode.id);
  };

  const handleEditNode = (nodeId: string, content: string, type: 'user' | 'assistant' | 'system', _isDraft = false) => {
    if (!session) return;
    
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    let updatedNode: ChatNodeType;
    
    if (type === 'system') {
      updatedNode = { ...node, userMessage: content };
    } else if (type === 'user') {
      updatedNode = { ...node, userMessage: content };
    } else {
      updatedNode = { ...node, assistantMessage: content };
    }

    updateNodeInSession(sessionId, updatedNode);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!session) return;
    deleteNodeFromSession(sessionId, nodeId);
    
    // 删除后不需要手动计算布局，useEffect会处理
    // setTimeout(() => {
    //   calculateNodeLayout();
    // }, 100);
  };

  /**
   * 跑一次生成请求。
   *
   * `contextNodes` 是拼上下文用的节点快照 —— 分支场景下新节点还没写进 store，
   * 必须显式传进来，否则第一次请求会漏掉它自己的 userMessage。落库那边用
   * updateNodeInSession 的 upsert，所以不怕调用时 store 里还没有这个 id。
   */
  const runNodeGeneration = async (nodeId: string, contextNodes: ChatNodeType[]) => {
    if (!session) return;

    const node = contextNodes.find(n => n.id === nodeId);
    if (!node) return;

    const model = models.find(m => m.id === node.modelId);
    if (!model) {
      // 以前这里是静默 return —— 点了「重新生成」什么都不发生，也没任何提示。
      // 导入的备份最容易撞上：文件里的模型没一起导入时 modelId 是悬空的。
      showError(t('该节点引用的模型不存在，请在节点设置里重新选一个模型'));
      return;
    }

    if (abortControllerRef.current[nodeId]) {
      abortControllerRef.current[nodeId].abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current[nodeId] = abortController;

    // 初始化流式响应
    setStreamingResponses(prev => ({
      ...prev,
      [nodeId]: ""
    }));
    setStreamingReasoning(prev => ({
      ...prev,
      [nodeId]: ""
    }));

    // 本次请求累积的正文与思维链
    let accumulatedResponse = '';
    let accumulatedReasoning = '';
    let accumulatedUsage: UsageStats | undefined;
    const startedAt = Date.now();

    try {
      const systemNode = contextNodes.find(n => n.type === 'system');
      const systemPrompt = systemNode?.userMessage || model.defaultSystemPrompt;

      const messages = [];

      if (systemPrompt) {
        messages.push({ role: 'system' as const, content: systemPrompt });
      }

      let currentParentId = node.parentId;
      const messageChain = [];

      while (currentParentId) {
        const parentNode = contextNodes.find(n => n.id === currentParentId);
        if (parentNode && parentNode.type === 'chat') {
          messageChain.unshift({
            user: parentNode.userMessage,
            assistant: parentNode.assistantMessage
          });
        }
        currentParentId = parentNode?.parentId || null;
      }

      messageChain.forEach(msg => {
        if (msg.user) messages.push({ role: 'user' as const, content: msg.user });
        if (msg.assistant) messages.push({ role: 'assistant' as const, content: msg.assistant });
      });

      messages.push({ role: 'user' as const, content: node.userMessage });

      // 会话标题还是默认值时，用第一个问题自动命名。纯本地字符串处理，
      // 不额外请求 API。用户在侧边栏改过标题后 action 内部会直接忽略。
      const derivedTitle = deriveSessionTitle(node.userMessage);
      if (derivedTitle) {
        autoTitleSession(sessionId, derivedTitle);
      }

      await sendChatRequest({
        messages,
        model,
        temperature: node.temperature,
        maxTokens: node.maxTokens,
        signal: abortController.signal,
        onChunk: (chunk) => {
          accumulatedResponse += chunk;
          // 只更新流式响应状态，不更新节点
          setStreamingResponses(prev => ({
            ...prev,
            [nodeId]: accumulatedResponse
          }));
        },
        // 思维链单独累积，不参与正文渲染，也不会回传给 API
        onReasoning: (chunk) => {
          accumulatedReasoning += chunk;
          // 同步喂给流式状态，让节点在等待正文时就能看到思考过程
          setStreamingReasoning(prev => ({
            ...prev,
            [nodeId]: accumulatedReasoning
          }));
        },
        onUsage: (u) => {
          accumulatedUsage = u;
        }
      });

      // 完成后再一次性更新节点内容
      updateNodeInSession(sessionId, {
        ...node,
        assistantMessage: accumulatedResponse,
        reasoning: accumulatedReasoning || undefined,
        usage: accumulatedUsage
          ? { ...accumulatedUsage, durationMs: Date.now() - startedAt }
          : undefined,
        isStreaming: false,
        error: undefined
      });

      // 清除流式状态（正文 + 思维链）。此时节点已经拿到持久化的
      // reasoning，继续流式渲染反而会和落库版本重复。
      clearStreamingState(nodeId);

    } catch (error: unknown) {
      console.error('Chat request failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to get response';

      updateNodeInSession(sessionId, {
        ...node,
        isStreaming: false,
        error: message,
        // 中途失败也保留已经产生的思维链，便于排查
        reasoning: accumulatedReasoning || undefined,
        usage: accumulatedUsage
          ? { ...accumulatedUsage, durationMs: Date.now() - startedAt }
          : undefined
      });

      // 清除流式状态
      clearStreamingState(nodeId);
    } finally {
      delete abortControllerRef.current[nodeId];
    }
  };

  /**
   * 「重新生成」按钮。
   *
   * 已经有回答时，另起一个**兄弟分支**（同一个父节点、同一条 userMessage），
   * 旧答案原样保留。这棵树的意义就是比较不同回答，覆盖掉旧答案等于把
   * 唯一的对照丢了。节点还没有回答时（刚发出去、或上次报错）才写回原节点。
   */
  const handleRetryNode = (nodeId: string) => {
    if (!session) return;

    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const model = models.find(m => m.id === node.modelId);
    if (!model) {
      showError(t('该节点引用的模型不存在，请在节点设置里重新选一个模型'));
      return;
    }

    if (node.assistantMessage || node.reasoning) {
      const branch: ChatNodeType = {
        ...node,
        id: crypto.randomUUID(),
        assistantMessage: '',
        reasoning: undefined,
        usage: undefined,
        error: undefined,
        isStreaming: true,
        createdAt: new Date().toISOString(),
        position: node.parentId ? computeChildPosition(node.parentId) : undefined,
      };

      addNodeToSession(sessionId, branch);
      setPendingFocusId(branch.id);
        showInfo(t('已创建新分支，正在重新生成…'));
      // 新节点还没进 store，上下文要手动带上它
      void runNodeGeneration(branch.id, [...session.nodes, branch]);
      return;
    }

    // 首次生成 / 报错后重试：直接写在原节点上
    updateNodeInSession(sessionId, {
      ...node,
      isStreaming: true,
      error: undefined,
      reasoning: undefined,
      usage: undefined
    });
    void runNodeGeneration(node.id, session.nodes);
  };

  /**
   * 原地重出。
   *
   * 和「重新生成」(onRetry) 的区别：**不另起分支**，直接把结果写回本节点。
   * 适用场景：用户改了这条消息的文字，希望「这个节点重新回答一遍」；
   * 想保留旧答案做对照的话，他可以自己从父节点拉一个新节点 —— 不在这里替他决定。
   */
  const handleResubmitNode = (nodeId: string) => {
    if (!session) return;

    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const model = models.find(m => m.id === node.modelId);
    if (!model) {
      showError(t('该节点引用的模型不存在，请在节点设置里重新选一个模型'));
      return;
    }

    // 先清掉旧回答：一是避免请求失败时旧内容又冒出来（文不对答），
    // 二是让 UI 立刻进入「重新生成中」，而不是旧答案和新流式内容混在一起。
    const cleared: ChatNodeType = {
      ...node,
      assistantMessage: '',
      reasoning: undefined,
      usage: undefined,
      error: undefined,
      isStreaming: true,
    };

    updateNodeInSession(sessionId, cleared);
    void runNodeGeneration(nodeId, session.nodes.map(n => (n.id === nodeId ? cleared : n)));
  };

  const handleModelChange = (nodeId: string, modelId: string) => {
    if (!session) return;
    
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    const nextModel = models.find(m => m.id === modelId);
    if (!nextModel) return;
    
    // system 节点的正文就是系统提示词，默认取的是「首次创建时那个模型」的
    // defaultSystemPrompt。所以换模型时，如果用户没动过这段提示词，就跟着换；
    // 一旦用户改过，就绝不覆盖 —— 那是他自己写的内容。
    let userMessage = node.userMessage;
    let promptReplaced = false;
    if (node.type === 'system') {
      const previousModel = models.find(m => m.id === node.modelId);
      const isUntouched = previousModel
        ? node.userMessage === previousModel.defaultSystemPrompt
        : node.userMessage.trim() === '';
      
      if (isUntouched && nextModel.defaultSystemPrompt !== node.userMessage) {
        userMessage = nextModel.defaultSystemPrompt;
        promptReplaced = true;
      }
    }
    
    updateNodeInSession(sessionId, {
      ...node,
      modelId,
      userMessage
    });
    
    // 提示统一从这里发：只有这里才知道系统提示词有没有被一并替换
    showInfo(
      promptReplaced
        ? t('已切换到 {name}，系统提示词一并更新', { name: nextModel.name })
        : t('已切换到模型: {name}', { name: nextModel.name })
    );
  };

  const handleTemperatureChange = (nodeId: string, temperature: number) => {
    if (!session) return;
    
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    updateNodeInSession(sessionId, {
      ...node,
      temperature
    });
  };

  const handleMaxTokensChange = (nodeId: string, maxTokens: number) => {
    if (!session) return;
    
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    updateNodeInSession(sessionId, {
      ...node,
      maxTokens
    });
  };

  const handleExport = () => {
    if (!session) return;
    try {
      exportToMindmap(session);
      showSuccess(t('导出成功'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      showError(t('导出失败: {msg}', { msg: message }));
    }
  };

  // 当前会话的 JSON 备份。和「设置 → 数据」里那份是同一套 schema，
  // 单会话导出也能直接导入别处。
  const handleExportSession = () => {
    if (!session) return;
    try {
      exportSessionToFile(session);
      showSuccess(t('会话已导出'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      showError(t('导出失败: {msg}', { msg: message }));
    }
  };

  // React Flow 量到节点真实尺寸后会派发 dimensions 变更。
  // 记下来：「重新排布」时用它算真实的子树宽度/行高，比猜的常量准得多。
  const collectNodeDimensions = useCallback((changes: NodeChange[]) => {
    setNodeDimensions(prev => {
      let next: typeof prev | null = null;
      for (const change of changes) {
        if (change.type !== 'dimensions' || !change.dimensions) continue;
        const { width, height } = change.dimensions;
        if (width <= 0 || height <= 0) continue;
        const old = prev[change.id];
        if (old && old.width === width && old.height === height) continue;
        next = next || { ...prev };
        next[change.id] = { width, height };
      }
      // 没有新信息就返回原引用，避免多余重渲染
      return next || prev;
    });
  }, []);

  const handleReorganizeLayout = useCallback(() => {
    // 必须传 true —— 否则 calculateNodeLayout 看到节点已有 position 就原样保留，
    // 这个按钮实际上只做了 fitView，根本没有重排。
    calculateNodeLayout(true);
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2 });
    }, 150);
  }, [calculateNodeLayout, reactFlowInstance]);

  useEffect(() => {
    if (session && session.nodes.length === 0 && models.length > 0) {
      // 用当前选中的默认模型，而不是模型列表里的第一个。
      // （defaultModelId 别处都在用，就这里漏了。）
      const initialModel = models.find(m => m.id === defaultModelId) ?? models[0];
      const systemNode: ChatNodeType = {
        id: crypto.randomUUID(),
        parentId: null,
        type: 'system',
        userMessage: initialModel.defaultSystemPrompt,
        assistantMessage: "",
        modelId: initialModel.id,
        temperature: initialModel.temperature ?? 0.7,
        maxTokens: initialModel.maxTokens || 8192,
        createdAt: new Date().toISOString(),
      };
      
      addNodeToSession(sessionId, systemNode);
    }
  }, [session, sessionId, models, defaultModelId, addNodeToSession]);


  // 节点 data 里的回调必须是稳定引用 —— 只要引用变了，所有节点都会重渲染。
  // 但回调本身又必须读到最新的 session / state，所以用 ref 转发：
  // 引用恒定，真正被调用时再去取当前渲染里那份实现。
  const latestHandlers = useRef({
    handleAddChildNode, handleEditNode, handleDeleteNode, handleRetryNode, handleResubmitNode,
    handleModelChange, handleTemperatureChange, handleMaxTokensChange,
  });
  latestHandlers.current = {
    handleAddChildNode, handleEditNode, handleDeleteNode, handleRetryNode, handleResubmitNode,
    handleModelChange, handleTemperatureChange, handleMaxTokensChange,
  };

  const nodeCallbacks = useMemo((): Omit<NodeData, 'node' | 'isRoot' | 'streamingResponse' | 'streamingReasoning'> => ({
    onAddChild: (parentId: string) => latestHandlers.current.handleAddChildNode(parentId),
    onEdit: (nodeId: string, content: string, type: 'user' | 'assistant' | 'system', isDraft?: boolean) =>
      latestHandlers.current.handleEditNode(nodeId, content, type, isDraft),
    onDelete: (nodeId: string) => latestHandlers.current.handleDeleteNode(nodeId),
    onRetry: (nodeId: string) => latestHandlers.current.handleRetryNode(nodeId),
    onResubmit: (nodeId: string) => latestHandlers.current.handleResubmitNode(nodeId),
    onModelChange: (nodeId: string, modelId: string) => latestHandlers.current.handleModelChange(nodeId, modelId),
    onTemperatureChange: (nodeId: string, temperature: number) =>
      latestHandlers.current.handleTemperatureChange(nodeId, temperature),
    onMaxTokensChange: (nodeId: string, maxTokens: number) =>
      latestHandlers.current.handleMaxTokensChange(nodeId, maxTokens),
  }), []);

  useEffect(() => {
    if (!session?.nodes) return;
  
    // 创建新的节点数组，确保使用节点保存的位置
    const previousNodes = flowNodesRef.current;

    const reactFlowNodes = session.nodes.map(node => {
      // 保存过位置就用保存的；没有（手工改过的导入文件、根节点）退回「父节点正下方」
      const position = resolveNodePosition(node, session.nodes);
      const liveResponse = streamingResponses[node.id] || null;
      const liveReasoning = streamingReasoning[node.id] || null;
      const autoFocus = pendingFocusId === node.id;
      const previous = previousNodes.get(node.id);

      // 完全没变就复用同一个对象引用 —— React Flow 会跳过这个节点的重渲染。
      // 否则流式输出时每来一个 token 都把全部节点换成新对象，整张图跟着重画。
      if (
        previous &&
        previous.data.node === node &&
        previous.data.streamingResponse === liveResponse &&
        previous.data.streamingReasoning === liveReasoning &&
        previous.data.autoFocus === autoFocus &&
        previous.position.x === position.x &&
        previous.position.y === position.y
      ) {
        return previous;
      }

      return buildFlowNode(node, position, {
        ...nodeCallbacks,
        node,
        streamingResponse: liveResponse,
        streamingReasoning: liveReasoning,
        isRoot: node.type === 'system',
        autoFocus
      }, previous);
    });

    setNodes(reactFlowNodes);
    commitEdges(buildFlowEdges(session.nodes));

  // Keep node callbacks bound to the current render without rebuilding this effect recursively.
  // pendingFocusId 也要进依赖：清掉它时得把 autoFocus 重新算成 false，
  // 否则节点上会一直挂着 autoFocus: true。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.nodes, sessionId, streamingResponses, streamingReasoning, pendingFocusId]); // 添加 sessionId 到依赖数组

  // 新建的节点可能落在视口外面（分支一多就往右排），所以渲染完成后把它平移到视野中间。
  //
  // setCenter 的 zoom 必须显式传：React Flow 在不传 zoom 时会用 maxZoom（默认 2），
  // 也就是会突然放大。这里保持当前缩放，只做平移。
  useEffect(() => {
    if (!pendingFocusId) return;
    const target = nodes.find(n => n.id === pendingFocusId);
    if (!target) return;

    setPendingFocusId(null);
    reactFlowInstance.setCenter(
      target.position.x + NODE_WIDTH / 2,
      target.position.y + NODE_HEIGHT / 2,
      { duration: 450, zoom: reactFlowInstance.getZoom() }
    );
  }, [pendingFocusId, nodes, reactFlowInstance]);
  

  if (!session) {
    return <div>Session not found</div>;
  }

  // 还没算出初始视口（首次进这个会话且没存过）：先摆一个空容器把宽度量到手。
  // useLayoutEffect 里 setState 会在浏览器绘制前同步重渲染，所以看不到空画板。
  if (!initialViewport) {
    return <div ref={paneRef} className="h-full w-full relative" />;
  }

  return (
    <div ref={paneRef} className="h-full w-full relative">
      <div className="absolute top-4 right-4 z-10 flex space-x-3">
        <button 
          className="flex items-center justify-center p-2 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors shadow-minimal"
          onClick={() => setShowStats(v => !v)}
          title={t('会话统计')}
        >
          <BarChart3 size={18} />
        </button>

        <button 
          className="flex items-center justify-center p-2 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors shadow-minimal"
          onClick={handleExportSession}
          title={t('导出当前会话（JSON）')}
        >
          <FileJson size={18} />
        </button>

        <button 
          className="flex items-center justify-center p-2 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors shadow-minimal"
          onClick={handleExport}
          title={t('导出思维导图')}
        >
          <Share2 size={18} />
        </button>
      </div>

      {showStats && <SessionStats session={session} onClose={() => setShowStats(false)} />}
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={initialViewport}
        minZoom={0.2}
        maxZoom={2}
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        elementsSelectable={true}
        fitView={false}
        defaultEdgeOptions={{ 
          type: 'smoothstep',
          style: { stroke: '#a3a3a3', strokeWidth: 1.5 }
        }}
        onNodesChange={(changes: NodeChange[]) => {
          setNodes(nds => applyNodeChanges(changes, nds));
          collectNodeDimensions(changes);
        }}
        onNodeDragStop={(_event, node) => {
          // 节点拖动结束后保存位置
          if (!session) return;
          
          const chatNode = session.nodes.find(n => n.id === node.id);
          if (!chatNode) return;
          
          // 更新节点位置
          updateNodeInSession(sessionId, {
            ...chatNode,
            position: {
              x: node.position.x,
              y: node.position.y
            }
          });
        }}
      >
        <Background color={theme === 'dark' ? '#2f2f2f' : '#f5f5f5'} gap={18} size={0.5} />
        <Controls className="bg-white border border-neutral-200 rounded-md shadow-minimal" />
      </ReactFlow>
      
      <div className="absolute bottom-4 right-4 z-10">
        <button 
          className="flex items-center justify-center p-2.5 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors shadow-minimal"
          onClick={handleReorganizeLayout}
          title={t('重新排布节点')}
        >
          <LayoutGrid size={18} />
        </button>
      </div>
    </div>
  );
};

const ChatFlow: React.FC<ChatFlowProps> = ({ sessionId }) => (
  <ReactFlowProvider>
    <ReactFlowWrapper key={sessionId} sessionId={sessionId} />
  </ReactFlowProvider>
);

export default ChatFlow;
