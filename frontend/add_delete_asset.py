import os

file_path = 'src/contexts/assets-context.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update AssetsContextType interface
old_interface_end = '''  getBalance: (assetId: string, address: string) => Promise<number>;
}'''
new_interface_end = '''  getBalance: (assetId: string, address: string) => Promise<number>;
  deleteAsset: (assetId: string) => Promise<void>;
}'''
content = content.replace(old_interface_end, new_interface_end)

# 2. Implement deleteAsset method
delete_asset_method = '''
  // ─ Delete asset (for cleaning up applications) ─
  const deleteAsset = useCallback(
    async (assetId: string) => {
      setLoading(true);
      try {
        await apiFetch(`/assets/${assetId}`, { method: "DELETE" });
        queryCache.invalidatePrefix("assets:");
        await loadAssets();
      } catch (err: any) {
        console.error("Failed to delete asset:", err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadAssets],
  );
'''

# Insert before getBalance
content = content.replace('  // ─ Get token balance ─', delete_asset_method + '\n  // ─ Get token balance ─')

# 3. Add to context provider value
old_value = '''    transferTokens,
    getBalance,
  };'''
new_value = '''    transferTokens,
    getBalance,
    deleteAsset,
  };'''
content = content.replace(old_value, new_value)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated assets-context.tsx with deleteAsset successfully")
