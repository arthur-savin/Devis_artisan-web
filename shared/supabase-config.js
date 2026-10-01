/**
 * Clé publishable uniquement (safe dans le navigateur).
 * La clé sb_secret ne doit jamais arriver ici.
 */
window.DEVIS_SUPABASE = {
  url: "https://eqqrvnmjnoudncfuwsxt.supabase.co",
  anonKey: "sb_publishable_5dMs5Ukb65rQ4WFiS5FE_w_Nj0nMpVk",
  artisanPublicId: "art_demo_01",
  // false : le dashboard s’ouvre sans mot de passe ni code.
  // Remettre true pour réactiver la connexion et les codes e-mail / SMS.
  authRequired: false,
};
