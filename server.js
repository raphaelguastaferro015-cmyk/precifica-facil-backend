// ═══════════════════════════════════════════════════
//  PRECIFICA FÁCIL — Backend Node.js
//  Hospede gratuitamente no Railway.app
// ═══════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const app     = express();

app.use(cors()); // Permite o site acessar o backend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Banco de dados em memória (simples para começar) ──
// ⚠️ Se o servidor reiniciar, os dados somem.
// Quando quiser persistir dados, troque por PostgreSQL (também gratuito no Railway).
const licenses = {};
// Exemplo de estrutura:
// { 'cliente@email.com': { plan: 'mensal', expiry: '2025-02-01', active: true } }

// ══════════════════════════════════════════
//  ROTA: Verificar licença
//  O site chama essa rota ao fazer login
// ══════════════════════════════════════════
app.get('/check-license', (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  const lic = licenses[email];

  // Sem licença cadastrada
  if (!lic) {
    return res.json({ plan: 'none', active: false, expiry: null });
  }

  // Vitalício — nunca vence
  if (lic.plan === 'vitalicio') {
    return res.json({ plan: 'vitalicio', active: true, expiry: null });
  }

  // Mensal — verifica se ainda está dentro do prazo
  if (lic.plan === 'mensal') {
    const now    = new Date();
    const expiry = new Date(lic.expiry);
    const active = expiry > now;
    return res.json({ plan: 'mensal', active, expiry: lic.expiry });
  }

  return res.json({ plan: 'none', active: false });
});

// ══════════════════════════════════════════
//  WEBHOOK — CAKTO
//  Cole essa URL no painel da Cakto em:
//  Configurações → Webhooks → Nova URL:
//  https://precifica-facil-backend-production.up.railway.app/webhook/cakto
// ══════════════════════════════════════════
app.post('/webhook/cakto', (req, res) => {
  try {
    const body = req.body;

    console.log('[Cakto] Webhook recebido:', JSON.stringify(body));

    // Cakto envia o status do pedido
    const status = (
      body?.status ||
      body?.order?.status ||
      body?.data?.status ||
      ''
    ).toLowerCase();

    // Pegar o email do comprador
    const email = (
      body?.customer?.email ||
      body?.data?.customer?.email ||
      body?.buyer?.email ||
      body?.email ||
      ''
    ).toLowerCase().trim();

    if (!email) {
      console.log('[Cakto] Webhook sem email — ignorado');
      return res.status(200).json({ ok: true });
    }

    // ⚠️ ALTERE os nomes para bater com seus produtos na Cakto
    // Ex: se seu produto vitalício se chama "Precifica Fácil Vitalício"
    const productName = (
      body?.product?.name ||
      body?.data?.product?.name ||
      body?.offer?.name ||
      ''
    ).toLowerCase();

    let plan = 'mensal'; // padrão
    if (
      productName.includes('vitalic') ||
      productName.includes('vitalício') ||
      productName.includes('lifetime') ||
      productName.includes('único') ||
      productName.includes('unico')
    ) {
      plan = 'vitalicio';
    }

    // Compra aprovada / paga
    if (
      status === 'paid' ||
      status === 'approved' ||
      status === 'complete' ||
      status === 'completed' ||
      status === 'active' ||
      status === 'confirmed'
    ) {
      activateLicense(email, plan);
      console.log(`[Cakto] ✅ Licença ativada — ${email} | Plano: ${plan}`);
    }

    // Reembolso, cancelamento ou chargeback
    if (
      status === 'refunded' ||
      status === 'canceled' ||
      status === 'cancelled' ||
      status === 'chargeback' ||
      status === 'expired'
    ) {
      revokeLicense(email);
      console.log(`[Cakto] ❌ Licença revogada — ${email}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Cakto] Erro no webhook:', err.message);
    return res.status(200).json({ ok: true }); // Sempre 200 para não reenviar
  }
});

// ══════════════════════════════════════════
//  PAINEL ADMIN (protegido por senha)
//  Acesse: https://SEU-BACKEND.railway.app/admin?senha=SUA_SENHA_SECRETA
// ══════════════════════════════════════════

// ⚠️ TROQUE ESSA SENHA antes de subir!
const ADMIN_PASSWORD = 'precifica2025';

// Ver todas as licenças
app.get('/admin/licenses', (req, res) => {
  if (req.query.senha !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Não autorizado' });
  return res.json(licenses);
});

// Ativar licença manualmente
app.post('/admin/activate', (req, res) => {
  if (req.query.senha !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Não autorizado' });
  const { email, plan } = req.body;
  if (!email || !plan) return res.status(400).json({ error: 'email e plan são obrigatórios' });
  activateLicense(email.toLowerCase().trim(), plan);
  return res.json({ ok: true, message: `Licença ativada para ${email}` });
});

// Revogar licença manualmente
app.post('/admin/revoke', (req, res) => {
  if (req.query.senha !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Não autorizado' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email obrigatório' });
  revokeLicense(email.toLowerCase().trim());
  return res.json({ ok: true, message: `Licença removida para ${email}` });
});

// ══════════════════════════════════════════
//  FUNÇÕES AUXILIARES
// ══════════════════════════════════════════
function activateLicense(email, plan) {
  let expiry = null;
  if (plan === 'mensal') {
    const d = new Date();
    d.setDate(d.getDate() + 32); // 32 dias de acesso
    expiry = d.toISOString();
  }
  licenses[email] = { plan, expiry, active: true, activatedAt: new Date().toISOString() };
}

function revokeLicense(email) {
  if (licenses[email]) {
    licenses[email].active = false;
    licenses[email].revokedAt = new Date().toISOString();
  }
}

// ══════════════════════════════════════════
//  HEALTH CHECK (Railway usa isso)
// ══════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Precifica Fácil Backend',
    licenses: Object.keys(licenses).length
  });
});

// ══════════════════════════════════════════
//  INICIAR SERVIDOR
// ══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Precifica Fácil Backend rodando na porta ${PORT}`);
});
