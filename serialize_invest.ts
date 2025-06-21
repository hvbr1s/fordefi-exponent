import { Connection, PublicKey, TransactionInstruction, VersionedTransaction, MessageV0, AddressLookupTableProgram, AddressLookupTableAccount, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { LOCAL_ENV, Market } from "@exponent-labs/exponent-sdk";
import { FordefiSolanaConfig, ExponentConfig} from './config'
import * as dotenv from 'dotenv';

dotenv.config();

// Market SDK instance cache
let marketSdk: Market | null = null;

async function getMarketSdk(marketAddress: string): Promise<Market> {
  if (!marketSdk) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const market = new PublicKey(marketAddress);
    marketSdk = await Market.load(LOCAL_ENV, connection, market);
  }
  return marketSdk;
}

function buildFordefiRequestBody(
  fordefiConfig: FordefiSolanaConfig,
  serializedMessage: string
) {
  return {
    "vault_id": fordefiConfig.vaultId,
    "signer_type": "api_signer",
    "sign_mode": "auto",
    "type": "solana_transaction",
    "details": {
      "fee": {
        "type": "priority",
        "priority_level": "medium"
      },
      "type": "solana_serialized_transaction_message",
      "push_mode": "auto",
      "data": serializedMessage,
      "chain": "solana_mainnet"
    },
    "wait_for_state": "signed"
  };
}

async function createAndSerializeTransaction(
  connection: Connection,
  payerKey: PublicKey,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = []
): Promise<string> {
  const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  
  const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 600_000, // it's a complex tx, we need a lot of CU!
  });
  const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 10_000, // Set a small priority fee
  });
  
  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash,
    instructions: [setComputeUnitLimitIx, setComputeUnitPriceIx, ...instructions], // Prepend compute budget instructions
  }).compileToV0Message(lookupTables);
  
  const tx = new VersionedTransaction(messageV0);
  
  return Buffer.from(tx.message.serialize()).toString('base64');
}

// Get current market information
export async function getMarketInfo(marketAddress: string) {
  const sdk = await getMarketSdk(marketAddress);
  console.log('--- Market Info ---');
  console.log('Current SY exchange rate:', sdk.currentSyExchangeRate.toString());
  console.log('Current PT discount:', sdk.ptDiscount.toString());
  
  // Example conversions
  const ybtAmount = 1000; // fragSOL amount
  const baseAmount = ybtAmount * sdk.currentSyExchangeRate;
  console.log(`${ybtAmount} fragSOL = ${baseAmount} SOL (base)`);
  
  const baseAmount2 = 1000; // SOL amount
  const ybtAmount2 = baseAmount2 / sdk.currentSyExchangeRate;
  console.log(`${baseAmount2} SOL (base) = ${ybtAmount2} fragSOL`);
  
  return {
    syExchangeRate: sdk.currentSyExchangeRate,
    ptDiscount: sdk.ptDiscount
  };
}

// Simulate buying PT with base asset
export async function simulateBuyPt(marketAddress: string, baseAssetAmount: number) {
  try {
    const sdk = await getMarketSdk(marketAddress);
    const estimatedPt = sdk.marketCalculator().estimateNetPtForExactNetAsset(-baseAssetAmount);
    if (estimatedPt === null) {
      console.log(`No PT estimate available for ${baseAssetAmount} base asset`);
      return null;
    }
    console.log(`Estimated PT for ${baseAssetAmount} base asset:`, estimatedPt.toString());
    return BigInt(Math.floor(estimatedPt)); // Round down to integer before converting
  } catch (error) {
    console.error('Error simulating buy PT:', error);
    throw error;
  }
}

// Simulate selling PT for base asset
export async function simulateSellPt(marketAddress: string, ptInAmount: number) {
  try {
    const sdk = await getMarketSdk(marketAddress);
    const estimatedBaseAsset = sdk.marketCalculator().calcTradePt(-ptInAmount);
    console.log(`Estimated base asset for selling ${ptInAmount} PT:`, estimatedBaseAsset);
    
    // Use the correct property name from the actual object structure
    const netAssetOut = estimatedBaseAsset.netTraderAsset;
    
    if (netAssetOut === undefined) {
      throw new Error('Could not find output amount in CalculatorTradeResult');
    }
    
    return BigInt(Math.floor(netAssetOut)); // Round down to integer before converting
  } catch (error) {
    console.error('Error simulating sell PT:', error);
    throw error;
  }
}

export async function createSellPtInstruction(
  marketAddress: string,
  owner: PublicKey, 
  ptAmount: bigint, 
  minBaseOut: bigint
): Promise<{ setupIxs: TransactionInstruction[]; ixs: TransactionInstruction[] }> {
  try {
    const sdk = await getMarketSdk(marketAddress);
    const sellPtIx = await sdk.ixWrapperSellPt({
      owner,
      amount: ptAmount,
      minBaseOut
    });
    
    console.log('Sell PT instruction created:', sellPtIx);
    return { setupIxs: sellPtIx.setupIxs, ixs: sellPtIx.ixs };
  } catch (error) {
    console.error('Error creating sell PT instruction:', error);
    throw error;
  }
}

// Create buy PT instruction
export async function createBuyPtInstruction(
  marketAddress: string, 
  owner: PublicKey, 
  ptOut: bigint, 
  maxBaseIn: bigint
): Promise<{ setupIxs: TransactionInstruction[]; ixs: TransactionInstruction[] }> {
  try {
    const sdk = await getMarketSdk(marketAddress);
    const buyPtIx = await sdk.ixWrapperBuyPt({
      owner,
      ptOut,
      maxBaseIn
    });
    
    console.log('Buy PT instruction created:', buyPtIx);
    return { setupIxs: buyPtIx.setupIxs, ixs: buyPtIx.ixs };
  } catch (error) {
    console.error('Error creating buy PT instruction:', error);
    throw error;
  }
}

// Create redeem at maturity instruction
export async function createRedeemInstruction(
  marketAddress: string,
  owner: PublicKey, 
  amountPy: bigint
): Promise<TransactionInstruction[]> {
  try {
    const sdk = await getMarketSdk(marketAddress);
    const redeemIx = await sdk.vault.ixMergeToBase({
      owner,
      amountPy
    });
    
    console.log('Redeem at maturity instruction created:', redeemIx);
    return [...redeemIx.setupIxs, ...redeemIx.ixs]; // Return all instructions
  } catch (error) {
    console.error('Error creating redeem instruction:', error);
    throw error;
  }
}

export async function createLookupTablePayload(
  connection: Connection,
  fordefiVault: PublicKey,
  fordefiConfig: FordefiSolanaConfig
) {
  const recentSlot = await connection.getSlot();
  const [createIx, tableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: fordefiVault,
    payer: fordefiVault,
    recentSlot
  });
  
  console.debug(`Your ALT will be created at https://solscan.io/account/${tableAddress}`);
  
  const serializedMessage = await createAndSerializeTransaction(
    connection,
    fordefiVault,
    [createIx]
  );
  
  return {
    payload: buildFordefiRequestBody(fordefiConfig, serializedMessage),
    lookupTableAddress: tableAddress
  };
}

export async function extendLookupTablePayload(
  connection: Connection,
  fordefiVault: PublicKey,
  fordefiConfig: FordefiSolanaConfig,
  tableAddress: PublicKey,
  addresses: PublicKey[]
) {
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: fordefiVault,
    authority: fordefiVault,
    lookupTable: tableAddress,
    addresses: addresses,
  });
  
  const serializedMessage = await createAndSerializeTransaction(
    connection,
    fordefiVault,
    [extendIx]
  );
  
  return buildFordefiRequestBody(fordefiConfig, serializedMessage);
}

// Create a payload for the setup transaction
export async function createSetupPayload(
  fordefiConfig: FordefiSolanaConfig,
  exponentConfig: ExponentConfig,
  lookupTable: AddressLookupTableAccount
) {
  console.log('=== Creating Setup Transaction Payload ===');
  const owner = new PublicKey(fordefiConfig.fordefiSolanaVaultAddress);
  const connection = new Connection('https://api.mainnet-beta.solana.com');

  // We only need the setup instructions for this transaction
  const { setupIxs } = await getInstructions(owner, exponentConfig);

  if (setupIxs.length === 0) {
    console.log('No setup instructions needed.');
    return null;
  }

  const serializedMessage = await createAndSerializeTransaction(
    connection,
    owner,
    setupIxs,
    [lookupTable]
  );
  
  return buildFordefiRequestBody(fordefiConfig, serializedMessage);
}

// Create a payload for the main investment transaction
export async function createInvestPayload(
  fordefiConfig: FordefiSolanaConfig,
  exponentConfig: ExponentConfig,
  lookupTable: AddressLookupTableAccount
) {
  console.log('=== Exponent Market SDK Investment ===');
  console.log(`Action: ${exponentConfig.action}`);
  console.log(`Amount: ${exponentConfig.investAmount} lamports`);
  
  const owner = new PublicKey(fordefiConfig.fordefiSolanaVaultAddress);
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  
  
  const { ixs } = await getInstructions(owner, exponentConfig);  
  const serializedMessage = await createAndSerializeTransaction(
    connection,
    owner,
    ixs,
    [lookupTable]
  );
  
  return buildFordefiRequestBody(fordefiConfig, serializedMessage);
}

// Helper to get both setup and main instructions
async function getInstructions(owner: PublicKey, exponentConfig: ExponentConfig) {
  switch (exponentConfig.action) {
    case 'buy':
      const estimatedPt = await simulateBuyPt(exponentConfig.market, Number(exponentConfig.investAmount));
      if (!estimatedPt) {
        throw new Error('Could not estimate PT amount for buy');
      }
      
      const ptOut = estimatedPt * 99n / 100n; // 1% slippage tolerance
      const maxBaseIn = exponentConfig.investAmount;
      
      return createBuyPtInstruction(
        exponentConfig.market,
        owner,
        ptOut,
        maxBaseIn
      );
      
    case 'sell':
      const estimatedBase = await simulateSellPt(exponentConfig.market, Number(exponentConfig.investAmount));
      if (!estimatedBase) {
        throw new Error('Could not estimate base amount for sell');
      }
      
      const minBaseOut = estimatedBase * 99n / 100n; // 1% slippage tolerance
      const ptAmount = exponentConfig.investAmount;
      
      return createSellPtInstruction(
        exponentConfig.market,
        owner,
        ptAmount,
        minBaseOut
      );
      
    default:
      throw new Error(`Unsupported action: ${exponentConfig.action}`);
  }
}