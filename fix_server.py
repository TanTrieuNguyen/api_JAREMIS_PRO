"""
Quick fix for server.js - Remove duplicate code causing syntax error
Run: python fix_server.py
"""

import re

# Read server.js
with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# The problematic line 805: let historyBlocks = historyBlocks.length
# This is part of a duplicate block that should be removed

# Find and remove the duplicate block (lines ~805-920)
# Pattern: from "const historySection = historyBlocks.length" to next "const fullPrompt"
# But keep the original one

# Split by app.post('/api/chat'
parts = content.split("app.post('/api/chat'", 1)
before_chat = parts[0]
chat_and_after = parts[1]

# Now find the duplicate section in chat_and_after
# Look for the second occurrence of "const historySection = historyBlocks.length"
matches = list(re.finditer(r'const historySection = historyBlocks\.length', chat_and_after))

if len(matches) >= 2:
    # Remove from second match backwards to find where duplicate starts
    second_match_pos = matches[1].start()
    
    # Find the start of duplicate (look for previous system Prompt2 or similar)
    # Search backwards for "const systemPrompt2"
    duplicate_start = chat_and_after.rfind('const systemPrompt2', 0, second_match_pos)
    
    if duplicate_start == -1:
        # Try finding by "- Tránh quá nhiều cấp phân level`;"  before historySection
        temp = chat_and_after[:second_match_pos]
        duplicate_start = temp.rfind('- Tránh quá nhiều cấp phân level`;')
        if duplicate_start != -1:
            duplicate_start = temp.rfind('\n', 0, duplicate_start) + 1
    
    # Find end of duplicate (next "// Strict timeout" or similar)
    duplicate_end = chat_and_after.find('// Strict timeout for flash', second_match_pos)
    
    if duplicate_start != -1 and duplicate_end != -1:
        print(f"Found duplicate block from pos {duplicate_start} to {duplicate_end}")
        print(f"Removing {duplicate_end - duplicate_start} characters")
        
        # Remove the duplicate
        fixed_chat = chat_and_after[:duplicate_start] + chat_and_after[duplicate_end:]
        
        # Reconstruct
        fixed_content = before_chat + "app.post('/api/chat'" + fixed_chat
        
        # Write back
        with open('server.js', 'w', encoding='utf-8') as f:
            f.write(fixed_content)
        
        print("✅ Fixed! Server.js has been updated.")
        print("Now run: node server.js")
    else:
        print(f"❌ Could not find exact duplicate boundaries")
        print(f"duplicate_start: {duplicate_start}, duplicate_end: {duplicate_end}")
else:
    print("❌ Could not find duplicate historySection")
    print(f"Found {len(matches)} matches")
