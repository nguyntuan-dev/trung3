from backend.cedict_parser import cedict
cedict.load()

# Search for specific characters
for char in ['我', '很', '高', '兴']:
    entry = cedict.lookup(char)
    if entry:
        print(f"Character: {char}")
        print(f"  Pinyin in CEDICT: '{entry['pinyin']}'")
        print()

# Now test conversion with actual pinyin format
print("\n=== Testing conversion ===")
test_pinyin = "wo3 hen3 gao1 xing4"
result = cedict.convert_pinyin_to_chinese(test_pinyin)
print(f"Input: {test_pinyin}")
print(f"Output: {result['output']}")
print(f"Items: {result['items']}")
