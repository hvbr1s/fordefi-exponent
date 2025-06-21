# Exponent Trading Tool

A robust Solana trading tool for interacting with Exponent markets using Fordefi. This tool handles complex DeFi transactions by automatically managing Address Lookup Tables (ALTs) and splitting large transactions into manageable pieces.

## Overview

This tool enables automated trading on Exponent markets (Principal Token markets) with the following features:

- **Buy/Sell Principal Tokens (PTs)** on Exponent markets
- **Automatic Address Lookup Table management** for large transactions
- **Multi-transaction workflow** to handle Solana's transaction size limits
- **Fordefi integration** for secure transaction signing
- **Smart setup detection** to avoid redundant account creation

## Architecture

### Core Components

1. **`serialize_invest.ts`** - Main trading logic and transaction serialization
2. **`run.ts`** - Orchestration script that manages the multi-step process
3. **`config.ts`** - Configuration management for Fordefi and Exponent settings
4. **Utils** - Helper functions for transaction processing and signing

### Transaction Flow

The tool implements a 4-step process to handle large Solana transactions:

```
Step 1: Create Address Lookup Table (ALT)
    ↓
Step 2: Extend ALT with required addresses
    ↓
Step 3: Execute Setup Transaction (create ATAs if needed)
    ↓
Step 4: Execute Main Investment Transaction
```

## Setup

### Prerequisites

- Node.js (v16 or higher)
- Fordefi Solana Vault, API User and API Signer
- Solana wallet with SOL for transaction fees

### Environment Variables

Create a `.env` file in the project root:

```env
FORDEFI_API_TOKEN=your_fordefi_api_token
SOLANA_VAULT_ID=your_solana_vault_id
SOLANA_VAULT_ADDRESS=your_solana_vault_address
```

### Installation

```bash
npm install
```

### Configuration

Edit `config.ts` to configure your trading parameters:

```typescript
export const exponentConfig: ExponentConfig = {
  market: "EJ4GPTCnNtemBVrT7QKhRfSKfM53aV2UJYGAC8gdVz5b", // fragSOL market
  investAmount: 1_000n, // Amount in smallest units
  useJito: false, // Use Jito for transaction broadcasting
  jitoTip: 1000, // Jito tip in lamports
  action: "buy", // "buy" or "sell"
  existingAltAddress: "", // Optional: reuse existing ALT
};
```

## Usage

### Basic Usage

```bash
npm run invest
```

### Configuration Options

#### Market Selection
- **fragSOL Market**: `EJ4GPTCnNtemBVrT7QKhRfSKfM53aV2UJYGAC8gdVz5b`
- **Other markets**: Check Exponent documentation for market addresses

#### Trading Actions
- **Buy PTs**: Use base asset to purchase Principal Tokens
- **Sell PTs**: Sell Principal Tokens for base asset

#### Amount Configuration
- Amounts are specified in the smallest unit (lamports for SOL, smallest token unit for other assets)
- Example: `1_000n` = 0.000001 SOL

## How It Works

### Step 1: Address Lookup Table Creation

The tool creates an on-chain Address Lookup Table to store frequently used account addresses. This reduces transaction size by referencing addresses with a single byte instead of full 32-byte public keys.

```typescript
// Creates a new ALT or reuses existing one
const { payload: createAltPayload, lookupTableAddress } = await createLookupTablePayload(
  connection, 
  fordefiVault, 
  fordefiConfig
);
```

### Step 2: ALT Extension

Populates the ALT with all account addresses needed for the transaction. Addresses are added in chunks of 20 to avoid transaction size limits.

```typescript
// Extends ALT with required addresses in chunks
const extendAltPayload = await extendLookupTablePayload(
  connection, 
  fordefiVault, 
  fordefiConfig, 
  lookupTableAddress, 
  chunk
);
```

### Step 3: Setup Transaction

Creates Associated Token Accounts (ATAs) required for the trade. The tool checks which accounts already exist and only creates missing ones.

```typescript
// Checks existing ATAs and only creates missing ones
const ataAddresses = setupIxs.map(ix => ix.keys[1]?.pubkey).filter(Boolean);
const existingAccounts = await connection.getMultipleAccountsInfo(ataAddresses);
const neededSetupIxs = setupIxs.filter((_, index) => existingAccounts[index] === null);
```

### Step 4: Main Investment Transaction

Executes the actual trade using the prepared ALT and accounts.

```typescript
// Executes the buy/sell transaction
const finalPayload = await createInvestPayload(
  fordefiConfig, 
  exponentConfig, 
  lookupTableAccount
);
```

## Key Features

### ALT Management

- **Reuse existing ALTs**: Set `existingAltAddress` to reuse previously created ALTs
- **Automatic extension**: Only adds new addresses that aren't already in the ALT
- **Chunked processing**: Handles large numbers of addresses efficiently

### Transaction Optimization

- **Compute budget management**: Automatically sets appropriate compute units (600,000) and priority fees
- **Versioned transactions**: Uses V0 transactions for better compression
- **Size optimization**: Splits large transactions to stay within Solana's limits

### Error Handling

- **Comprehensive validation**: Checks for missing accounts, insufficient funds, and other common issues
- **Graceful degradation**: Skips unnecessary steps when possible
- **Detailed logging**: Provides clear feedback on each step's progress

## Troubleshooting

### Common Issues

#### "insufficient funds" (token error)
**Cause**: Vault doesn't have enough of the required token
**Solution**: 
- For buy actions: Ensure vault has enough base token
- For sell actions: Ensure vault has enough PT tokens

#### "computational budget exceeded"
**Cause**: Transaction is too complex for default compute limit
**Solution**: The tool automatically handles this by setting higher compute limits

#### "encoding overruns Uint8Array"
**Cause**: Transaction is too large for Solana's size limit
**Solution**: The tool automatically splits transactions and uses ALTs

### Debugging

Enable detailed logging by checking the console output:

```bash
npm run invest
```

The tool provides logs for each step:
- Market information and rates
- ALT creation/extension status
- Account creation progress
- Transaction execution results

## Advanced Usage

### Reusing ALTs

After the first successful run, you can reuse the created ALT:

```typescript
export const exponentConfig: ExponentConfig = {
  // ... other config
  existingAltAddress: "AXc94U7cQUyWkoFjRJuuAa2nhb7zgu4c46yTpt72Skpm",
};
```

### Custom Market Configuration

To trade on different Exponent markets:

1. Find the market address from Exponent's documentation
2. Update the `market` field in `config.ts`
3. Ensure your Fordefi Solana vault has the required tokens for that market