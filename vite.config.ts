import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: '127.0.0.1',
    strictPort: false,
    /*
     * 等文件「写完不再变」再通知 HMR。
     *
     * 不加这个，Windows 上偶尔会出现：编辑器/工具把文件截断重写的瞬间 chokidar
     * 就发了 change 事件，Vite 读到半截（甚至 0 字节）的内容并**缓存**下来 ——
     * 之后这个模块一直返回 `Content-Length: 0`，浏览器报
     * `does not provide an export named 'default'`，整个应用白屏，
     * 只有删掉 node_modules/.vite 重启才能恢复。
     * 让 watcher 多等一会儿，等 size 稳定了再读，就不会读到写一半的文件。
     */
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 50,
      },
    },
  },
});
