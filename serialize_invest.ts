import { LOCAL_ENV, Market } from "@exponent-labs/exponent-sdk";
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { fordefiConfig, FordefiSolanaConfig, exponentConfig} from './run'
import * as dotenv from 'dotenv';

dotenv.config();

export async function simulateInvest(fordefiConfig: FordefiSolanaConfig) {
  // Setup connection
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  
  // fragSOL market address
  const market = new PublicKey(exponentConfig.market);
  
  // Load the market SDK
  const marketSdk = await Market.load(LOCAL_ENV, connection, market);
  
  // Example: Your signer (replace with your actual keypair)
  // const signer = Keypair.fromSecretKey(/* your secret key */);
  
  // Example: Selling PT-fragSOL for fragSOL
  async function sellPtForFragSol(owner: PublicKey, ptAmount: bigint, minBaseOut: bigint) {
    try {
      // Get the sell PT instruction
      const sellPtIx = marketSdk.ixWrapperSellPt({
        owner,
        amount: ptAmount,
        minBaseOut
      });
      
      console.log('Sell PT instruction created:', sellPtIx);
      return sellPtIx;
    } catch (error) {
      console.error('Error creating sell PT instruction:', error);
      throw error;
    }
  }
  
  // Example: Buying PT-fragSOL with fragSOL
  async function buyPtWithFragSol(owner: PublicKey, ptOut: bigint, maxBaseIn: bigint) {
    try {
      // Get the buy PT instruction
      const buyPtIx = marketSdk.ixWrapperBuyPt({
        owner,
        ptOut,
        maxBaseIn
      });
      
      console.log('Buy PT instruction created:', buyPtIx);
      return buyPtIx;
    } catch (error) {
      console.error('Error creating buy PT instruction:', error);
      throw error;
    }
  }
  
  // Example: Redeeming PT at maturity
  async function redeemAtMaturity(owner: PublicKey, amountPy: bigint) {
    try {
      const redeemIx = marketSdk.vault.ixMergeToBase({
        owner,
        amountPy
      });
      
      console.log('Redeem at maturity instruction created:', redeemIx);
      return redeemIx;
    } catch (error) {
      console.error('Error creating redeem instruction:', error);
      throw error;
    }
  }
  
  // Example: Simulations
  async function simulateBuyPt(baseAssetAmount: number) {
    try {
      // Estimate how much PT you'll get for a given base asset amount
      const estimatedPt = marketSdk.marketCalculator().estimateNetPtForExactNetAsset(-baseAssetAmount);
      if (estimatedPt === null) {
        console.log(`No PT estimate available for ${baseAssetAmount} base asset`);
        return null;
      }
      console.log(`Estimated PT for ${baseAssetAmount} base asset:`, estimatedPt.toString());
      return estimatedPt;
    } catch (error) {
      console.error('Error simulating buy PT:', error);
      throw error;
    }
  }
  
  async function simulateSellPt(ptInAmount: number) {
    try {
      // Estimate how much base asset you'll get for selling PT
      const estimatedBaseAsset = marketSdk.marketCalculator().calcTradePt(-ptInAmount);
      console.log(`Estimated base asset for selling ${ptInAmount} PT:`, estimatedBaseAsset.toString());
      return estimatedBaseAsset;
    } catch (error) {
      console.error('Error simulating sell PT:', error);
      throw error;
    }
  }
  
  // Example: Get current market information
  function getMarketInfo() {
    console.log('Current SY exchange rate:', marketSdk.currentSyExchangeRate.toString());
    console.log('Current PT discount:', marketSdk.ptDiscount.toString());
    
    // Example conversions
    const ybtAmount = 1000; // fragSOL amount
    const baseAmount = ybtAmount * marketSdk.currentSyExchangeRate;
    console.log(`${ybtAmount} fragSOL = ${baseAmount} SOL (base)`);
    
    const baseAmount2 = 1000; // SOL amount
    const ybtAmount2 = baseAmount2 / marketSdk.currentSyExchangeRate;
    console.log(`${baseAmount2} SOL (base) = ${ybtAmount2} fragSOL`);
  }
  
  // Run examples
  console.log('=== Exponent Market SDK Examples ===');
  
  // Get market info
  getMarketInfo();
  
  // Example simulations (these don't require a signer)
  await simulateBuyPt(1000); // Simulate buying PT with 1000 SOL worth
  await simulateSellPt(500);  // Simulate selling 500 PT
  
  // Example instruction creation (commented out since we don't have a signer)
  // const exampleOwner = new PublicKey('YourPublicKeyHere');
  // await sellPtForFragSol(exampleOwner, 100, 95); // Sell 100 PT for minimum 95 base
  // await buyPtWithFragSol(exampleOwner, 100, 105); // Buy 100 PT for maximum 105 base
  // await redeemAtMaturity(exampleOwner, 100); // Redeem 100 PT at maturity
}