import re

with open('app.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Let's find exactly where the Uncaught SyntaxError: Unexpected token '{' is.
# We will use a regex to look for any missing commas or unexpected braces in the class methods.
methods = re.findall(r'(\s+)(\w+)\(container, user\) \{', text)
for m in methods:
    print('Found method:', m[1])

print('Total backticks:', text.count('`'))
