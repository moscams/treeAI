import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  Edge,
  Node,
  useReactFlow,
  applyNodeChanges,
  NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import SystemNode from './nodes/SystemNode';
import ChatNode from './nodes/ChatNode';
import { useSessionStore } from '../stores/sessionStore';
import { useModelStore } from '../stores/modelStore';
import { useThemeStore } from '../stores/themeStore';
import { ChatNode as ChatNodeType, UsageStats } from '../types';
import { sendChatRequest } from '../services/apiService';
import { Share2, LayoutGrid, FileUp } from 'lucide-react';
import { exportToMindmap } from '../utils/exportUtils';
import FileUploadButton from './FileUploadButton';
import { showSuccess, showError } from '../utils/notification';
import { DEFAULT_SESSION_TITLE, deriveSessionTitle } from '../utils/sessionTitle';

const nodeTypes = {
  system: SystemNode,
  chat: ChatNode,
};

interface ChatFlowProps {
  sessionId: string;
}

const ReactFlowWrapper: React.FC<ChatFlowProps> = ({ sessionId }) => {
  const { sessions, addNodeToSession, updateNodeInSession, deleteNodeFromSession, updateSession } = useSessionStore();
  const { models, defaultModelId } = useModelStore();
  const { theme } = useThemeStore();
  const session = sessions.find(s => s.id === sessionId);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const reactFlowInstance = useReactFlow();
  const abortControllerRef = useRef<Record<string, AbortController>>({});
  const [nodeDimensions, setNodeDimensions] = useState<Record<string, { width: number, height: number }>>({});
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
  
    // 必须和 index.css 里 .node-content / .system-node 的宽度保持一致（560px），
    // 否则子树宽度算得比实际窄，兄弟节点会重叠。
    const defaultNodeWidth = 560;
    // 高度无法预先知道（回答长短不一），这是估值；
    // 真实尺寸由 collectNodeDimensions 量到后覆盖。
    const defaultNodeHeight = 420;
    const horizontalSpacing = 220;
    const verticalSpacing = 140;
    
    const getNodeDimensions = (nodeId: string) => {
      return nodeDimensions[nodeId] || { width: defaultNodeWidth, height: defaultNodeHeight };
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
        return total + width + (index < children.length - 1 ? horizontalSpacing : 0);
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
      
      const nextLevelY = y + height + verticalSpacing;
      
      const children = session.nodes.filter(n => n.parentId === nodeId);
      let childStartX = startX;
      
      children.forEach(child => {
        const childWidth = subtreeWidths.get(child.id) || getNodeDimensions(child.id).width;
        calculateNodePosition(child.id, childStartX, level + 1, nextLevelY);
        childStartX += childWidth + horizontalSpacing;
      });
    };
  
    if (systemNode) {
      const rootWidth = subtreeWidths.get(systemNode.id) || getNodeDimensions(systemNode.id).width;
      calculateNodePosition(systemNode.id, -rootWidth / 2, 0, 0);
    }
  
    const reactFlowNodes = session.nodes.map(node => {
      // 强制重新布局 或 节点没有保存位置时，使用计算的位置
      let position: { x: number, y: number };
      if (!forceRecalculate && node.position) {
        position = node.position; // 保留原有位置
      } else {
        const calculatedPosition = nodePositions.get(node.id);
        position = calculatedPosition || { x: 0, y: 0 };
        
        // 如果是强制重新布局，保存新位置到 session
        if (forceRecalculate) {
          updateNodeInSession(sessionId, {
            ...node,
            position: { x: position.x, y: position.y }
          });
        }
      }
      
      return {
        id: node.id,
        type: node.type,
        position,
        data: { 
          node,
          streamingResponse: streamingResponses[node.id] || null,
          streamingReasoning: streamingReasoning[node.id] || null,
          onAddChild: handleAddChildNode,
          onEdit: handleEditNode,
          onDelete: handleDeleteNode,
          onRetry: handleRetryNode,
          onModelChange: handleModelChange,
          onTemperatureChange: handleTemperatureChange,
          onMaxTokensChange: handleMaxTokensChange,
          isRoot: node.type === 'system'
        }
      };
    });
  
    const reactFlowEdges = session.nodes
      .filter(node => node.parentId)
      .map(node => ({
        id: `e-${node.parentId}-${node.id}`,
        source: node.parentId!,
        target: node.id,
        type: 'smoothstep',
        animated: false,
      }));
  
    setNodes(reactFlowNodes);
    setEdges(reactFlowEdges);
  
    // 调整视图以显示所有节点
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2 });
    }, 50);
  
  // The handlers below intentionally read the latest session state from this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, nodeDimensions, streamingResponses, streamingReasoning, sessionId, updateNodeInSession]);  


  const handleAddChildNode = (parentId: string) => {
    if (!session || !defaultModelId) return;
    
    const parentNode = session.nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    // 查找父节点的 ReactFlow 节点，获取其位置
    const parentFlowNode = nodes.find(n => n.id === parentId);
    let position = { x: 0, y: 0 };
    
    if (parentFlowNode) {
      // 计算子节点的初始位置：父节点下方偏右
      const siblingCount = nodes.filter(n => 
        n.data.node.parentId === parentId
      ).length;
      
      position = {
        x: parentFlowNode.position.x + siblingCount * 100,
        y: parentFlowNode.position.y + 250
      };
    }

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
      position // 保存初始位置
    };

    addNodeToSession(sessionId, newNode);
  };

  const handleEditNode = (nodeId: string, content: string, type: 'user' | 'assistant' | 'system') => {
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

  const handleRetryNode = async (nodeId: string) => {
    if (!session) return;
    
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    const model = models.find(m => m.id === node.modelId);
    if (!model) return;
    
    if (abortControllerRef.current[nodeId]) {
      abortControllerRef.current[nodeId].abort();
    }
    
    const abortController = new AbortController();
    abortControllerRef.current[nodeId] = abortController;
    
    // 只更新streaming状态，不更新内容
    updateNodeInSession(sessionId, {
      ...node,
      isStreaming: true,
      error: undefined,
      reasoning: undefined,
      usage: undefined
    });
    
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
      const systemNode = session.nodes.find(n => n.type === 'system');
      const systemPrompt = systemNode?.userMessage || model.defaultSystemPrompt;
      
      const messages = [];
      
      if (systemPrompt) {
        messages.push({ role: 'system' as const, content: systemPrompt });
      }
      
      let currentParentId = node.parentId;
      const messageChain = [];
      
      while (currentParentId) {
        const parentNode = session.nodes.find(n => n.id === currentParentId);
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
      // 不额外请求 API。用户在侧边栏改过标题后这里就不再介入。
      if (session.title === DEFAULT_SESSION_TITLE) {
        const derivedTitle = deriveSessionTitle(node.userMessage);
        if (derivedTitle) {
          updateSession({ ...session, title: derivedTitle });
        }
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
        isStreaming: false
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

  const handleModelChange = (nodeId: string, modelId: string) => {
    if (!session) return;
    
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    updateNodeInSession(sessionId, {
      ...node,
      modelId
    });
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
      showSuccess('导出成功');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      showError('导出失败:' + message);
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
      const systemNode: ChatNodeType = {
        id: crypto.randomUUID(),
        parentId: null,
        type: 'system',
        userMessage: models[0].defaultSystemPrompt,
        assistantMessage: "",
        modelId: models[0].id,
        temperature: models[0].temperature ?? 0.7,
        maxTokens: models[0].maxTokens || 8192,
        createdAt: new Date().toISOString(),
      };
      
      addNodeToSession(sessionId, systemNode);
    }
  }, [session, sessionId, models, addNodeToSession]);

  const handleUploadComplete = (extractedText: string) => {
    if (!session || !defaultModelId) return;
    
    const systemNode = session.nodes.find(n => n.type === 'system');
    if (!systemNode) return;

    const newNode: ChatNodeType = {
      id: crypto.randomUUID(),
      parentId: systemNode.id,
      type: 'chat',
      userMessage: extractedText,
      assistantMessage: "",
      modelId: systemNode.modelId || defaultModelId,
      temperature: systemNode.temperature || 0.7,
      maxTokens: systemNode.maxTokens || 8192,
      createdAt: new Date().toISOString(),
    };

    addNodeToSession(sessionId, newNode);
  };

  useEffect(() => {
    console.debug("session or nodes changed");
    if (!session?.nodes) return;
  
    // 创建新的节点数组，确保使用节点保存的位置
    const reactFlowNodes = session.nodes.map(node => {
      // 优先使用节点保存的位置，如果没有则使用默认位置
      const position = node.position || { x: 0, y: 0 };
      
      return {
        id: node.id,
        type: node.type,
        position,
        data: { 
          node,
          streamingResponse: streamingResponses[node.id] || null,
          streamingReasoning: streamingReasoning[node.id] || null,
          onAddChild: handleAddChildNode,
          onEdit: handleEditNode,
          onDelete: handleDeleteNode,
          onRetry: handleRetryNode,
          onModelChange: handleModelChange,
          onTemperatureChange: handleTemperatureChange,
          onMaxTokensChange: handleMaxTokensChange,
          isRoot: node.type === 'system'
        }
      };
    });
  
    const reactFlowEdges = session.nodes
      .filter(node => node.parentId)
      .map(node => ({
        id: `e-${node.parentId}-${node.id}`,
        source: node.parentId!,
        target: node.id,
        type: 'smoothstep',
        animated: false,
      }));
  
    setNodes(reactFlowNodes);
    setEdges(reactFlowEdges);

  // Keep node callbacks bound to the current render without rebuilding this effect recursively.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.nodes, sessionId, streamingResponses, streamingReasoning]); // 添加 sessionId 到依赖数组
  

  if (!session) {
    return <div>Session not found</div>;
  }

  return (
    <div className="h-full w-full relative">
      <div className="absolute top-4 right-4 z-10 flex space-x-3">
        <FileUploadButton onUploadComplete={handleUploadComplete}>
          <button 
            className="flex items-center justify-center p-2 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors shadow-minimal"
            title="上传文件"
          >
            <FileUp size={18} />
          </button>
        </FileUploadButton>
        
        <button 
          className="flex items-center justify-center p-2 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:bg-neutral-50 transition-colors shadow-minimal"
          onClick={handleExport}
          title="导出思维导图"
        >
          <Share2 size={18} />
        </button>
      </div>
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
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
        onNodeDragStop={(event, node) => {
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
          title="重新排布节点"
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
