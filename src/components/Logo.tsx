import React from 'react';

/**
 * 应用标识。
 *
 * 和 `public/favicon.svg` **画的是同一张图** —— 浏览器标签页图标、侧边栏标题、
 * 「设置 → 关于」页共用同一个标识，避免出现“标签页一个 logo、应用里另一个 logo”。
 * 改这里的时候记得同步改 favicon.svg（两处都是手写的同一份路径）。
 */
interface LogoProps {
  size?: number;
  className?: string;
}

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
    <path
      d="M16 45 28 35m0 0 11-12m-11 12h15m-4-12h10"
      fill="none"
      stroke="#9fe0bf"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="16" cy="45" r="4" fill="#f4fbf7" />
    <circle cx="28" cy="35" r="4" fill="#f4fbf7" />
    <circle cx="39" cy="23" r="4" fill="#f4fbf7" />
    <circle cx="43" cy="35" r="4" fill="#f4fbf7" />
    <circle cx="49" cy="23" r="4" fill="#f4fbf7" />
  </svg>
);

export default Logo;
