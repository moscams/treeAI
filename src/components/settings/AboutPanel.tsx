import React from 'react';
import { Github, Heart, ExternalLink, Sparkles, ShieldCheck } from 'lucide-react';
import Logo from '../Logo';

// 与 package.json 的 version 保持一致。刻意不 import JSON —— 那会把整个
// package.json 打进产物里，为了一行版本号不值得。
const APP_VERSION = '0.1.0';

const UPSTREAM_URL = 'https://github.com/Anionex/treeAI';
const FORK_URL = 'https://github.com/moscams/treeAI';

interface LinkButtonProps {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const LinkButton: React.FC<LinkButtonProps> = ({ href, icon, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    className="inline-flex items-center space-x-2 px-3 py-2 border border-neutral-200 rounded-md text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
  >
    {icon}
    <span>{children}</span>
    <ExternalLink size={12} className="text-neutral-400" />
  </a>
);

const FEATURES = [
  '树状分支对话：同一个问题可以有很多种回答，并排比较',
  '任意 OpenAI 兼容服务：DeepSeek / OpenAI / Ollama / 各种兼容层',
  '推理模型友好：思考链实时显示、可回看，推理强度可配',
  '每条回答的 token 用量与缓存命中率统计',
  '本地优先：数据只存在浏览器的 IndexedDB，不上传任何服务器',
  '完全离线运行：零第三方 CDN 请求，可部署到内网',
  'JSON 备份与恢复，单个会话也能单独导出',
];

const AboutPanel: React.FC = () => {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <section className="text-center">
        <div className="flex justify-center mb-3">
          <Logo size={48} />
        </div>
        <h3 className="text-lg font-medium text-neutral-800">Tree AI Plus</h3>
        <p className="text-xs text-neutral-400 mt-0.5">v{APP_VERSION} · MIT License</p>
        <p className="text-sm text-neutral-500 mt-3 leading-relaxed">
          一个把线性对话变成画布的本地优先工作台。
          每个回答都可以继续分叉，把「换一种问法」「换一个模型」变成可以对照的树。
        </p>
      </section>

      <section>
        <h4 className="flex items-center text-sm font-medium text-neutral-800 mb-2">
          <Sparkles size={15} className="mr-1.5 text-neutral-400" />
          它能做什么
        </h4>
        <ul className="space-y-1.5">
          {FEATURES.map(feature => (
            <li key={feature} className="flex items-start text-sm text-neutral-600">
              <span className="mt-1.5 mr-2 w-1 h-1 rounded-full bg-neutral-400 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4 className="flex items-center text-sm font-medium text-neutral-800 mb-2">
          <ShieldCheck size={15} className="mr-1.5 text-neutral-400" />
          数据与隐私
        </h4>
        <p className="text-sm text-neutral-600 leading-relaxed">
          会话与模型配置都保存在这台浏览器里，卸载或清理浏览器数据会一并删除，
          请定期用「设置 → 数据」导出备份。API Key 绝不会进入备份文件。
        </p>
      </section>

      <section className="pt-2 border-t border-neutral-100">
        <h4 className="text-sm font-medium text-neutral-800 mb-2">项目链接</h4>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={FORK_URL} icon={<Github size={15} />}>
            本分支源码
          </LinkButton>
          <LinkButton href={UPSTREAM_URL} icon={<Github size={15} />}>
            上游项目
          </LinkButton>
        </div>
        <p className="mt-3 text-xs text-neutral-400 leading-relaxed">
          Tree AI Plus 是 <a href={UPSTREAM_URL} target="_blank" rel="noreferrer noopener" className="underline hover:text-neutral-600">Anionex/treeAI</a> 的增强分支。
          如果你觉得有用，欢迎给两个仓库都点个 Star。
        </p>
      </section>

      <p className="flex items-center justify-center text-xs text-neutral-400 pt-2">
        用 <Heart size={12} className="mx-1 text-rose-400" fill="currentColor" /> 构建
      </p>
    </div>
  );
};

export default AboutPanel;
