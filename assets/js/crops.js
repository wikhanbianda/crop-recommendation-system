// Nama tampilan (Indonesia) + emoji untuk 22 kelas dataset. Label model tetap bahasa Inggris huruf kecil.
export const CROPS = {
  apple: ['Apel', '🍎'], banana: ['Pisang', '🍌'], blackgram: ['Kacang urad', '🫘'], chickpea: ['Kacang arab', '🫘'], coconut: ['Kelapa', '🥥'],
  coffee: ['Kopi', '☕'], cotton: ['Kapas', '🌿'], grapes: ['Anggur', '🍇'], jute: ['Goni (jute)', '🌿'], kidneybeans: ['Kacang merah', '🫘'],
  lentil: ['Lentil', '🫘'], maize: ['Jagung', '🌽'], mango: ['Mangga', '🥭'], mothbeans: ['Kacang moth', '🫘'], mungbean: ['Kacang hijau', '🫛'],
  muskmelon: ['Melon', '🍈'], orange: ['Jeruk', '🍊'], papaya: ['Pepaya', '🍈'], pigeonpeas: ['Kacang gude', '🫛'], pomegranate: ['Delima', '🍎'],
  rice: ['Padi', '🌾'], watermelon: ['Semangka', '🍉'],
};
export const cropName = (c) => (CROPS[c] ? CROPS[c][0] : c);
export const cropEmoji = (c) => (CROPS[c] ? CROPS[c][1] : '🌱');
