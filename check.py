import re
with open('app_live.js', 'r', encoding='utf-8') as f:
    text = f.read()
# Let's count backticks and see if there is an unterminated one.
# Wait, let's just find the exact lines 2018-2025 where the error points and check for anything weird.
lines = text.split('\n')
for i in range(2015, 2025):
    if i < len(lines):
        print(f'{i+1}: {lines[i]}')
