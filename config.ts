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
  existingAlt?: string;
};

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
  action: "buy", // buy -> to aquire PT tokens / sell -> to aquire fragSOL
  existingAlt: "AXc94U7cQUyWkoFjRJuuAa2nhb7zgu4c46yTpt72Skpm", // <-- If you've already created and extended your ALT add it here
};