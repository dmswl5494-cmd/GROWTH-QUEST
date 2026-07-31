def check_braces(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        code = f.read()

    i = 0
    length = len(code)
    in_string = False
    string_char = ''
    in_single_comment = False
    in_multi_comment = False
    in_template = False
    template_depth = 0
    
    count = 0
    brace_stack = []

    while i < length:
        c = code[i]
        
        if in_single_comment:
            if c == '\n':
                in_single_comment = False
            i += 1
            continue
            
        if in_multi_comment:
            if c == '*' and i + 1 < length and code[i+1] == '/':
                in_multi_comment = False
                i += 2
                continue
            i += 1
            continue
            
        if in_string:
            if c == '\\':
                i += 2
                continue
            if c == string_char:
                in_string = False
            i += 1
            continue
            
        if in_template:
            if c == '\\':
                i += 2
                continue
            if c == '`':
                in_template = False
            elif c == '$' and i + 1 < length and code[i+1] == '{':
                template_depth += 1
                count += 1
                brace_stack.append(('template_expr', i))
                i += 2
                continue
            i += 1
            continue
            
        # Not in any string or comment
        if c == '/' and i + 1 < length:
            if code[i+1] == '/':
                in_single_comment = True
                i += 2
                continue
            elif code[i+1] == '*':
                in_multi_comment = True
                i += 2
                continue
                
        if c in ["'", '"']:
            in_string = True
            string_char = c
            i += 1
            continue
            
        if c == '`':
            in_template = True
            i += 1
            continue
            
        if c == '{':
            count += 1
            brace_stack.append(('block', i))
        elif c == '}':
            if len(brace_stack) > 0:
                last_type, last_idx = brace_stack.pop()
                if last_type == 'template_expr':
                    template_depth -= 1
                    in_template = True
            count -= 1
            if count < 0:
                print(f"Mismatched }} found at index {i} (line {code[:i].count(chr(10))+1})")
                
        i += 1

    print(f"Final brace count: {count}")
    if count > 0:
        print("Unclosed braces at:", [code[:idx].count(chr(10))+1 for t, idx in brace_stack])

check_braces('app_live.js')
