import { CREDIT_TOPUP_PACKS, CreditTopupPack } from '../../config/pricing.config.js';

export interface CreditPack {
  id: string;
  credits: number;
  price: number;
  best?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_20', credits: 20, price: 200 },
  { id: 'starter', credits: 50, price: 500 },
  { id: 'growth', credits: 100, price: 1000, best: true },
  { id: 'scale', credits: 250, price: 2500 },
  { id: 'pack_500', credits: 500, price: 5000 },
];
