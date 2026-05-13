import os

file_path = 'src/contexts/assets-context.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update mapIndexedAsset parameter type
old_params = '''  deployedAt?: string | null;
}): RWAAsset {'''
new_params = '''  deployedAt?: string | null;
  lifecycleState?: string;
}): RWAAsset {'''
content = content.replace(old_params, new_params)

# 2. Update RWAAsset return object
old_return = '''    chainId: process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta",
  };'''
new_return = '''    chainId: process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta",
    lifecycleState: asset.lifecycleState || "ISSUED",
  };'''
content = content.replace(old_return, new_return)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated assets-context.tsx successfully")
