import http.server
import socketserver
import urllib.parse
import threading
import os
import sys

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/log'):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            msg = query.get('msg', [''])[0]
            print(f'CAPTURED_ERROR: {msg}')
            with open('error_log.txt', 'w') as f:
                f.write(msg)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'OK')
            # Terminate server after receiving the log
            threading.Thread(target=self.server.shutdown).start()
        else:
            super().do_GET()

with socketserver.TCPServer(("", 8000), MyHandler) as httpd:
    print("serving at port 8000")
    httpd.serve_forever()
