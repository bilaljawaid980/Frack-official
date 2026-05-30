'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Coins } from 'lucide-react';
import { useWallet } from '@/hooks/use-wallet';
import { apiFetch } from '@/lib/backend';
import { validateSolanaAddress } from '@/lib/utils';
import { toast } from 'sonner';

interface IssueMoreTokensProps {
  assetId: number;
  assetName: string;
  currentTokenized: number | null;
  underlyingValue: number | null;
  onSuccess?: () => void;
}

function formatOptionalNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "Pending review";
}

function formatOptionalCurrency(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toLocaleString()}`
    : "Pending review";
}

export function IssueMoreTokens({
  assetId,
  assetName,
  currentTokenized,
  underlyingValue,
  onSuccess,
}: IssueMoreTokensProps) {
  const { address } = useWallet();
  const [recipient, setRecipient] = useState(address || '');
  const [amount, setAmount] = useState('');
  const [isIssuing, setIsIssuing] = useState(false);

  const handleIssue = async () => {
    if (!address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!recipient || !amount) {
      toast.error('Please enter recipient and amount');
      return;
    }

    if (!validateSolanaAddress(recipient)) {
      toast.error('Invalid recipient address');
      return;
    }

    const parsedAmount = Number.parseInt(amount, 10);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('Invalid amount');
      return;
    }

    setIsIssuing(true);
    const loadingToast = toast.loading('Submitting issuance request...');

    try {
      const assets = await apiFetch<
        { factoryAssetId?: number | null; tokenContract: string }[]
      >('/assets');
      const asset = assets.find(
        (item) => Number(item.factoryAssetId) === assetId
      );

      if (!asset?.tokenContract) {
        throw new Error('Token contract not found for this asset');
      }

      // MIGRATED: issuance now creates an off-chain request; minting happens after approval.
      const requestId =
        Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);

      await apiFetch('/issuance-requests', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          tokenContract: asset.tokenContract,
          assetId,
          recipient,
          requester: address,
          amount,
        }),
      });

      toast.success(
        <div>
          <p className="font-semibold">Issuance request submitted!</p>
          <p className="text-xs mt-1">
            Approve and mint from the Issuance Manager.
          </p>
        </div>,
        { id: loadingToast }
      );

      setAmount('');
      onSuccess?.();
    } catch (error: any) {
      console.error('Issue failed:', error);
      toast.error(error.message || 'Failed to issue tokens', { id: loadingToast });
    } finally {
      setIsIssuing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Issue More Tokens for Asset
        </CardTitle>
        <CardDescription>
          Mint additional tokens specifically for this asset (updates tokenization tracking)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info Banner */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Asset-Specific Token Issuance</AlertTitle>
          <AlertDescription className="text-xs mt-1">
            This is different from generic minting. These tokens will be tracked as part of
            Asset #{assetId} and will update the asset's <code className="px-1 py-0.5 bg-muted rounded">total_tokenized</code> counter.
          </AlertDescription>
        </Alert>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border bg-muted/50">
          <div>
            <p className="text-sm font-medium">Asset ID</p>
            <p className="text-2xl font-bold">#{assetId}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Current Tokenized</p>
            <p className="text-2xl font-bold">
              {formatOptionalNumber(currentTokenized)}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Asset Name</p>
            <p className="text-lg">{assetName}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Underlying Value</p>
            <p className="text-lg">{formatOptionalCurrency(underlyingValue)}</p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipient">Recipient Address</Label>
            <Input
              id="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Solana wallet address"
              disabled={isIssuing}
            />
            <p className="text-xs text-muted-foreground">
              Address must be verified in Identity Registry
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (raw units, 6 decimals)</Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000000"
              disabled={isIssuing}
              min="1"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Enter raw amount (e.g., 1000000 = 1.00 token)</span>
              {amount && (
                <span className="font-medium">
                  = {(parseInt(amount) / 1000000).toFixed(2)} tokens
                </span>
              )}
            </div>
          </div>

          <Button
            onClick={handleIssue}
            disabled={isIssuing || !recipient || !amount}
            className="w-full"
            size="lg"
          >
            {isIssuing ? 'Submitting...' : 'Submit Issuance Request'}
          </Button>
        </div>

        {/* Explanation Box */}
        <div className="p-4 rounded-lg border bg-muted/30 text-sm space-y-2">
          <p className="font-medium">What happens when you issue:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Creates an issuance request for asset #{assetId}</li>
            <li>Requires token controller approval before minting</li>
            <li>Mints RWASEC tokens to recipient after approval</li>
            <li>Updates asset's <code className="px-1 py-0.5 bg-muted rounded">total_tokenized</code> counter</li>
            <li>Updates total token supply after mint</li>
            <li>Tokens remain tied to this specific asset</li>
          </ul>
        </div>

        {/* Difference Explanation */}
        <div className="p-4 rounded-lg border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-950/20 text-sm">
          <p className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
            Asset Issuance vs Generic Mint
          </p>
          <div className="space-y-1 text-blue-800 dark:text-blue-200 text-xs">
            <p><strong>Asset Issuance</strong> (this button):</p>
            <ul className="list-disc list-inside ml-2 mb-2">
              <li>Submits issuance request for this asset</li>
              <li>Requires approval and mint in Issuance Manager</li>
              <li>Updates asset.total_tokenized after mint</li>
            </ul>
            <p><strong>Generic Mint</strong> (/transfer → Admin → Mint):</p>
            <ul className="list-disc list-inside ml-2">
              <li>Mints generic RWASEC tokens</li>
              <li>NOT tied to any specific asset</li>
              <li>Does NOT update any asset stats</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
