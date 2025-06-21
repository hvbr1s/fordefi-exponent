import { createAndSignTx } from './utils/process_tx'
import { 
  getMarketInfo,
  createSetupPayload,
  createInvestPayload, 
  createLookupTablePayload, 
  extendLookupTablePayload,
  createBuyPtInstruction,
  createSellPtInstruction
} from './serialize_invest'
import { pushToJito } from './utils/push_to_jito'
import { signWithApiSigner } from './signer';
import { fordefiConfig, FordefiSolanaConfig, exponentConfig } from './config';
import { Connection, PublicKey } from '@solana/web3.js'

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

  // Log market info at the start
  await getMarketInfo(exponentConfig.market);

  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const fordefiVault = new PublicKey(fordefiConfig.fordefiSolanaVaultAddress);
  let lookupTableAddress: PublicKey;

  // This script follows a multi-step process to handle large transactions using an Address Lookup Table (LUT).
  if (exponentConfig.existingAlt) {
    console.log(`--- Reusing existing Address Lookup Table: ${exponentConfig.existingAlt} ---`);
    lookupTableAddress = new PublicKey(exponentConfig.existingAlt);
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

  // First, fetch the current state of the ALT
  const lutAccount = (await connection.getAddressLookupTable(lookupTableAddress)).value;
  if (!lutAccount) {
    throw new Error(`Failed to fetch LUT: ${lookupTableAddress.toBase58()}`);
  }
  const existingAddresses = new Set(lutAccount.state.addresses.map(addr => addr.toBase58()));
  console.log(`LUT currently has ${existingAddresses.size} addresses.`);

  // Determine which addresses are required for our transaction
  const { setupIxs, ixs } = exponentConfig.action === 'buy'
    ? await createBuyPtInstruction(exponentConfig.market, fordefiVault, 1n, 1n)
    : await createSellPtInstruction(exponentConfig.market, fordefiVault, 1n, 1n);
  
  const requiredInstructions = [...setupIxs, ...ixs];

  const requiredAddresses = new Set<string>();
  requiredInstructions.forEach(ix => {
    requiredAddresses.add(ix.programId.toBase58());
    ix.keys.forEach(key => requiredAddresses.add(key.pubkey.toBase58()));
  });

  // Filter for addresses that are not already in the ALT
  const newAddresses = Array.from(requiredAddresses).filter(addr => !existingAddresses.has(addr));

  if (newAddresses.length === 0) {
    console.log('All required addresses are already in the ALT. Skipping extension.');
  } else {
    console.log(`Found ${newAddresses.length} new addresses to add to the LUT.`);
    const addressesToExtend = newAddresses.map(addr => new PublicKey(addr));
    
    // Chunk and send the new addresses
    const chunkSize = 20;
    for (let i = 0; i < addressesToExtend.length; i += chunkSize) {
      const chunk = addressesToExtend.slice(i, i + chunkSize);
      console.log(`\n--- Sending Chunk ${i / chunkSize + 1} to extend LUT with ${chunk.length} addresses ---`);
      const extendLutPayload = await extendLookupTablePayload(connection, fordefiVault, fordefiConfig, lookupTableAddress, chunk);
      await sendPayloadToFordefi(extendLutPayload, fordefiConfig);
    }
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