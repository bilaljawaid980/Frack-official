with open('src/app/(dashboard)/issuance/page.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix pending logic
text = text.replace(
    'asset.complianceStatus === "pending"',
    'asset.lifecycleState === "PENDING_APPROVAL"'
)

# Add missing function for approval
text = text.replace(
    'const handleQuickIssue = () => {',
    '''const { issueAsset } = useAssetsContext();
  const handleApprove = async (asset: any) => {
    try {
      const issuanceRequest = {
        assetDetails: {
          name: asset.name,
          symbol: asset.symbol,
          description: asset.description,
          assetType: asset.assetType,
          location: asset.location || "",
          currency: asset.currency || "USD",
          underlyingValue: asset.underlyingValue || 0,
          totalSupply: asset.totalSupply || 0,
          legalOwner: asset.issuerWallet || asset.issuer || ""
        },
        complianceRequirements: {
          kycRequired: true,
          amlRequired: true,
          accreditedInvestorsOnly: false,
          jurisdiction: ["us"]
        },
        tokenDetails: {
          tokenName: asset.name,
          tokenSymbol: asset.symbol,
          decimals: 6,
          initialPrice: 1,
          owner: asset.issuerWallet || asset.issuer || "",
          issuer: asset.issuerWallet || asset.issuer || "",
          controller: asset.issuerWallet || asset.issuer || "",
        },
        documents: []
      };
      
      // Use existing issueAsset which creates the token on-chain
      await issueAsset(issuanceRequest);
      toast.success("Application approved and deployed!");
      
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickIssue = () => {'''
)

# Change rendering of pending issuances list
text = text.replace(
    '''                      <Button size="sm" variant="outline">
                        Review
                      </Button>''',
    '''                      <Button size="sm" variant="outline" onClick={() => handleApprove(asset)}>
                        Approve & Deploy
                      </Button>'''
)

with open('src/app/(dashboard)/issuance/page.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
print('Done')
