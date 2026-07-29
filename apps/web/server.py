#!/usr/bin/env python3
"""轻量级 SPA 静态文件服务器 — 所有非文件请求回退到 index.html"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
DIR = sys.argv[2] if len(sys.argv) > 2 else '/var/www/html'

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def translate_path(self, path):
        fs_path = super().translate_path(path)
        # 如果文件不存在，回退到 index.html（SPA 路由支持）
        if not os.path.exists(fs_path) or os.path.isdir(fs_path):
            index = os.path.join(DIR, 'index.html')
            if os.path.exists(index):
                return index
        return fs_path

if __name__ == '__main__':
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), SPAHandler)
    print(f'Serving {DIR} on port {PORT} (SPA mode)')
    httpd.serve_forever()
