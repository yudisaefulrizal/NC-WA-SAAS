// Fixture bisnis sintetis untuk pengujian CS lengkap; tidak memuat data klien.
export const businessSamples = {
  knowledge: 'Toko Uji Nusantara. Buka Senin–Sabtu 09.00–17.00.',
  products: [
    {
      name: 'Produk Basic',
      type: 'product',
      description: 'Produk harian',
      price: 150000,
      stock: 10,
      active: true,
      image_id: '11111111-1111-4111-8111-111111111111',
    },
  ],
  orders: [
    {
      id: 'ORDER-UJI-B',
      customer: '628000000002',
      items: [{ product_name: 'Produk Basic', quantity: 1, price: 150000 }],
      total: 150000,
      status: 'pesanan_masuk',
      notes: '',
    },
  ],
  pending: [],
};
