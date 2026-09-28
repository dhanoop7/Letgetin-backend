export interface CreditPack {
  id: string;
  credits: number;
  price: number;
  best?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'starter', credits: 100, price: 999 },
  { id: 'growth', credits: 500, price: 3999, best: true },
  { id: 'scale', credits: 1500, price: 9999 },
];
