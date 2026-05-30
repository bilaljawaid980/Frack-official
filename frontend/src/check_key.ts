import { Connection, PublicKey } from '@solana/web3.js';

const rpcUrl = 'https://api.devnet.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

const targetKey = new PublicKey('GTmjkyU2ytXDxjSwUES3dJ6aYrnR89xqREtkVyoEBLnh');

async function checkAccount() {
  console.log('Checking account:', targetKey.toBase58());
  try {
    const info = await connection.getAccountInfo(targetKey);
    if (!info) {
      console.log('Account does not exist on devnet.');
    } else {
      console.log('Owner program:', info.owner.toBase58());
      console.log('Data length:', info.data.length);
      console.log('Lamports:', info.lamports);
    }
  } catch (err) {
    console.error('Error checking account:', err);
  }
}

checkAccount();
