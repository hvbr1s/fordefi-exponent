import { createAndSignTx } from './utils/process_tx'
import { 
  createSetupPayload,
  createInvestPayload, 
  createLookupTablePayload, 
  extendLookupTablePayload,
  createBuyPtInstruction,
  createSellPtInstruction
} from './serialize_invest'
import { pushToJito } from './utils/push_to_jito'
import { signWithApiSigner } from './signer';
import { Connection, PublicKey, AddressLookupTableAccount, TransactionInstruction } from '@solana/web3.js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

export interface FordefiSolanaConfig {
  accessToken: string;
  vaultId: string;
  fordefiSolanaVaultAddress: string;
  privateKeyPem: string;
  apiPathEndpoint: string;
};

export interface ExponentConfig {
  market: string;
  investAmount: bigint;
  useJito: boolean;
  jitoTip: number;
  action: "buy" | "sell";
  existingLutAddress?: string; // Optional: Provide an existing LUT address to reuse it
};

// Fordefi Config to configure
export const fordefiConfig: FordefiSolanaConfig = {
  accessToken: process.env.FORDEFI_API_TOKEN || "",
  vaultId: process.env.SOLANA_VAULT_ID || "",
  fordefiSolanaVaultAddress: process.env.SOLANA_VAULT_ADDRESS || "",
  privateKeyPem: fs.readFileSync('./secret/private.pem', 'utf8'),
  apiPathEndpoint: '/api/v1/transactions/create-and-wait'
};

export const exponentConfig: ExponentConfig = {
  market: "EJ4GPTCnNtemBVrT7QKhRfSKfM53aV2UJYGAC8gdVz5b", // fragSOL market
  investAmount: 1_000n, // in smallest fragSOL units (9 decimals -> https://solscan.io/token/FRAGSEthVFL7fdqM8hxfxkfCZzUvmg21cqPJVvC1qdbo)
  useJito: false, // if true we'll use Jito instead of Fordefi to broadcast the signed transaction
  jitoTip: 1000, // Jito tip amount in lamports (1 SOL = 1e9 lamports)
  action: "sell",
  existingLutAddress: "AXc94U7cQUyWkoFjRJuuAa2nhb7zgu4c46yTpt72Skpm", // <-- PASTE YOUR EXISTING LUT ADDRESS HERE
};

async function sendPayloadToFordefi(payload: any, fordefiConfig: FordefiSolanaConfig) {
  const requestBody = JSON.stringify(payload);
  const timestamp = new Date().getTime();
  const signature = await signWithApiSigner(`${fordefiConfig.apiPathEndpoint}|${timestamp}|${requestBody}`, fordefiConfig.privateKeyPem);
  
  console.log('Sending payload to Fordefi...');
  const response = await createAndSignTx(fordefiConfig.apiPathEndpoint, fordefiConfig.accessToken, signature, timestamp, requestBody);
  console.log('Fordefi API Response:', response.data);

  // It can take a moment for the transaction to be visible on-chain.
  console.log('Waiting for on-chain confirmation...');
  await new Promise(resolve => setTimeout(resolve, 5000)); 

  return response.data;
}

async function main(): Promise<void> {
  if (!fordefiConfig.accessToken || !fordefiConfig.vaultId || !fordefiConfig.fordefiSolanaVaultAddress) {
    console.error('Error: Please set FORDEFI_API_TOKEN, SOLANA_VAULT_ID, and SOLANA_VAULT_ADDRESS environment variables.');
    return;
  }

  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const fordefiVault = new PublicKey(fordefiConfig.fordefiSolanaVaultAddress);
  let lookupTableAddress: PublicKey;

  // This script follows a multi-step process to handle large transactions using an Address Lookup Table (LUT).
  // NOTE: If a step fails, you may need to comment out completed steps and re-run.

  if (exponentConfig.existingLutAddress) {
    console.log(`--- Reusing existing Address Lookup Table: ${exponentConfig.existingLutAddress} ---`);
    lookupTableAddress = new PublicKey(exponentConfig.existingLutAddress);
    // We skip Step 1 since the LUT already exists.
  } else {
    // --- Step 1: Create Address Lookup Table ---
    console.log('--- Step 1: Creating Address Lookup Table ---');
    const { payload: createLutPayload, lookupTableAddress: newLutAddress } = await createLookupTablePayload(connection, fordefiVault, fordefiConfig);
    lookupTableAddress = newLutAddress;
    
    console.log(`The new LUT address will be: ${lookupTableAddress.toBase58()}`);
    await sendPayloadToFordefi(createLutPayload, fordefiConfig);
    console.log('--- Step 1: Complete ---');
  }
  
  
  // --- Step 2: Extend Address Lookup Table ---
  console.log('\n--- Step 2: Extending Address Lookup Table ---');
  const { setupIxs, ixs } = exponentConfig.action === 'buy'
    ? await createBuyPtInstruction(exponentConfig.market, fordefiVault, 1n, 1n)
    : await createSellPtInstruction(exponentConfig.market, fordefiVault, 1n, 1n);
  
  const tempInstructions = [...setupIxs, ...ixs];

  const addressesToExtend = new Set<string>();
  tempInstructions.forEach(ix => {
    addressesToExtend.add(ix.programId.toBase58());
    ix.keys.forEach(key => addressesToExtend.add(key.pubkey.toBase58()));
  });
  const uniqueAddresses = Array.from(addressesToExtend).map(addr => new PublicKey(addr));

  const chunkSize = 20;
  for (let i = 0; i < uniqueAddresses.length; i += chunkSize) {
    const chunk = uniqueAddresses.slice(i, i + chunkSize);
    console.log(`\n--- Sending Chunk ${i / chunkSize + 1} to extend LUT ---`);
    const extendLutPayload = await extendLookupTablePayload(connection, fordefiVault, fordefiConfig, lookupTableAddress, chunk);
    await sendPayloadToFordefi(extendLutPayload, fordefiConfig);
  }
  console.log('--- Step 2: Complete ---');

  
  // --- Step 3: Execute the Setup Transaction ---
  console.log('\n--- Step 3: Executing the Setup Transaction ---');
  const lookupTableAccount = (await connection.getAddressLookupTable(lookupTableAddress)).value;

  if (!lookupTableAccount) {
    console.error(`Failed to fetch the lookup table: ${lookupTableAddress}. Please ensure the create and extend transactions have been confirmed.`);
    return;
  }
  
  const setupPayload = await createSetupPayload(fordefiConfig, exponentConfig, lookupTableAccount);
  
  if (setupPayload) {
    await sendPayloadToFordefi(setupPayload, fordefiConfig);
    console.log('--- Step 3: Complete ---');
  } else {
    console.log('--- Step 3: Skipped (No setup instructions needed) ---');
  }


  // --- Step 4: Execute the Investment Transaction ---
  console.log('\n--- Step 4: Executing the Investment ---');

  // We refetch the lookup table here in case it took a while for the setup tx to finalize.
  // Although not strictly necessary if the setup tx doesn't modify the LUT.
  const finalLookupTableAccount = (await connection.getAddressLookupTable(lookupTableAddress)).value;
  if (!finalLookupTableAccount) {
    console.error(`Failed to fetch the lookup table: ${lookupTableAddress}.`);
    return;
  }

  const finalPayload = await createInvestPayload(fordefiConfig, exponentConfig, finalLookupTableAccount);
  
  await sendPayloadToFordefi(finalPayload, fordefiConfig);
  console.log('--- Step 4: Complete ---');
  console.log('\nInvestment transaction sent successfully!');
}

if (require.main === module) {
  main();
};