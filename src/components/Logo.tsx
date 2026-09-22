import React from 'react';

/**
 * 应用标识。
 *
 * 和 `public/favicon.svg` **画的是同一张图** —— 浏览器标签页图标、侧边栏标题、
 * 「设置 → 关于」页共用同一个标识，避免出现“标签页一个 logo、应用里另一个 logo”。
 * 改这里的时候记得同步改 favicon.svg（两处都是手写的同一份路径）。
 *
 * 造型：三个**空心节点**（上一个、下两个），上面那个分叉出两条 smoothstep
 * 连线（先竖 → 横 → 竖，和画布里的边一个走法），底下垫一层细网格，对应画布的
 * `Background`。网格线只铺 8..56，不碰四角，所以不需要 clipPath。
 */
interface LogoProps {
  size?: number;
  className?: string;
}

// 网格线坐标 8,16,...,56；只画到 56，免得溢出 16px 的圆角
const GRID = [8, 16, 24, 32, 40, 48, 56];

const Logo: React.FC<LogoProps> = ({ size = 28, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    className={className}
    role="img"
    aria-label="Tree AI Plus"
  >
    <rect width="64" height="64" rx="16" fill="#13231d" />

    {/* 背景网格：和连线同色系，压到 0.14 透明度 */}
    <g fill="none" stroke="#9fe0bf" strokeOpacity="0.14" strokeWidth="1">
      {GRID.map((v) => (
        <React.Fragment key={v}>
          <line x1={v} y1="8" x2={v} y2="56" />
          <line x1="8" y1={v} x2="56" y2={v} />
        </React.Fragment>
      ))}
    </g>

    {/* 分叉连线：从上面那个节点往下走，再分左右 */}
    <path
      d="M32 20.5V31H17V41.5 M32 20.5V31H47V41.5"
      fill="none"
      stroke="#9fe0bf"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* 三个空心节点：填底色把连线末端盖住，接口才干净 */}
    <g fill="#13231d" stroke="#9fe0bf" strokeWidth="3.5">
      <circle cx="32" cy="15" r="4.5" />
      <circle cx="17" cy="47" r="4.5" />
      <circle cx="47" cy="47" r="4.5" />
    </g>
  </svg>
);

export default Logo;
