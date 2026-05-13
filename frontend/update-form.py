import re

with open('d:/Work/Fracks/3643/frontend/src/components/rwa/issuance-form.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Remove redundant fields from validation schema
text = re.sub(
    r'tokenDetails: z\.object\(\{[\s\S]*?documents:',
    '''tokenDetails: z.object({
    decimals: z.number().min(0).max(18).default(6),
    initialPrice: z.number().min(0.01, "Price must be at least $0.01"),
  }),
  documents:''',
    text
)

# 2. Remove default values
text = re.sub(
    r'tokenDetails: \{[\s\S]*?documents: \[\],',
    '''tokenDetails: {
        decimals: 6,
        initialPrice: 1.0,
      },
      documents: [],''',
    text
)

# 3. Remove useEffect tokenDetails syncing
text = re.sub(
    r'// Set defaults from the connected wallet[\s\S]*?form\.setValue\([\s\S]*?"tokenDetails\.controller"[\s\S]*?\);\s*\}',
    '}',
    text
)

# 4. Update onSubmit payload
text = re.sub(
    r'tokenDetails: data\.tokenDetails,',
    '''tokenDetails: {
          tokenName: data.assetDetails.name,
          tokenSymbol: data.assetDetails.symbol,
          decimals: data.tokenDetails.decimals,
          initialPrice: data.tokenDetails.initialPrice,
          owner: data.assetDetails.legalOwner || address || "",
          issuer: data.assetDetails.legalOwner || address || "",
          controller: data.assetDetails.legalOwner || address || "",
        },''',
    text
)

# 5. Update step 4 validation fields
text = re.sub(
    r'case 4:\s*return \[\s*"tokenDetails\.tokenName",\s*"tokenDetails\.tokenSymbol",\s*"tokenDetails\.initialPrice",\s*"documents",\s*\];',
    '''case 4:
        return [
          "tokenDetails.initialPrice",
          "documents",
        ];''',
    text
)

# 6. Make form wider
text = text.replace('className="max-w-4xl mx-auto"', 'className="w-full mx-auto"')

# 7. Remove Step 4 fields from UI
step4Start = text.find('name="tokenDetails.tokenName"')
step4End = text.find('{/* Document Upload */}')
if step4Start != -1 and step4End != -1:
    gridStart = text.rfind('<div className="grid grid-cols-1 md:grid-cols-2 gap-6">', 0, step4Start)
    if gridStart != -1:
        replacement = '''<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="tokenDetails.decimals"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Decimals</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(parseInt(value))
                        }
                        defaultValue={field.value.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18].map((dec) => (
                            <SelectItem key={dec} value={dec.toString()}>
                              {dec}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              '''
        text = text[:gridStart] + replacement + text[step4End:]

with open('d:/Work/Fracks/3643/frontend/src/components/rwa/issuance-form.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

print('Done')
