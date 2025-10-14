import { ethers } from 'ethers';

const inputString = 'owlia-ai-account';
const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(inputString));

console.log('Input string:', inputString);
console.log('Salt (keccak256 hash):', salt);
