var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
        test: {
            include: ['src/**/*.{test,spec}.{ts,tsx}'],
            exclude: __spreadArray(__spreadArray([], configDefaults.exclude, true), ['e2e/**', 'node_modules/**'], false),
        },
        server: {
            port: 5173,
            host: '0.0.0.0',
            proxy: {
                '/api': {
                    target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
                    changeOrigin: true,
                },
            },
        },
        esbuild: {
            drop: ['console', 'debugger'],
        },
        build: {
            target: 'es2020',
            sourcemap: false,
            minify: 'esbuild',
            rollupOptions: {
                output: {
                    manualChunks: function (id) {
                        if (id.includes('node_modules')) {
                            if (id.includes('react') || id.includes('scheduler'))
                                return 'vendor-react';
                            if (id.includes('@tanstack'))
                                return 'vendor-query';
                        }
                    }
                },
            },
        },
    };
});
