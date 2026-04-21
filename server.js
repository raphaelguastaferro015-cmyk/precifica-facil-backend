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
//  WEBHOOK — HOTMART
//  Cole a URL desse endpoint no painel da Hotmart:
//  https://SEU-BACKEND.railway.app/webhook/hotmart
// ══════════════════════════════════════════
app.post('/webhook/hotmart', (req, res) => {
  try {
    const body = req.body;

    // Hotmart envia o evento em body.event
    const event = body?.event || body?.data?.purchase?.status;

    // Pegar o email do comprador
    const email = (
      body?.data?.buyer?.email ||
      body?.buyer?.email ||
      ''
    ).toLowerCase().trim();

    if (!email) {
      console.log('[Hotmart] Webhook recebido sem email:', JSON.stringify(body));
      return res.status(200).json({ ok: true }); // Sempre responder 200 para a Hotmart
    }

    // Mapear o nome do produto para o plano
    // ⚠️ ALTERE os nomes abaixo para bater com os nomes dos seus produtos na Hotmart
    const productName = (
      body?.data?.product?.name ||
      body?.product?.name ||
      ''
    ).toLowerCase();

    let plan = 'mensal'; // padrão
    if (productName.includes('vitalic') || productName.includes('lifetime') || productName.includes('único')) {
      plan = 'vitalicio';
    }

    // Processar eventos de compra aprovada
    if (
      event === 'PURCHASE_APPROVED' ||
      event === 'PURCHASE_COMPLETE' ||
      event === 'APPROVED' ||
      event === 'complete'
    ) {
      activateLicense(email, plan);
      console.log(`[Hotmart] ✅ Licença ativada — ${email} | Plano: ${plan}`);
    }

    // Processar cancelamento ou chargeback
    if (
      event === 'PURCHASE_CANCELED' ||
      event === 'PURCHASE_CHARGEBACK' ||
      event === 'PURCHASE_REFUNDED' ||
      event === 'CANCELED' ||
      event === 'REFUNDED'
    ) {
      revokeLicense(email);
      console.log(`[Hotmart] ❌ Licença revogada — ${email}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Hotmart] Erro no webhook:', err.message);
    return res.status(200).json({ ok: true }); // Sempre 200 para não reenviar
  }
});

// ══════════════════════════════════════════
//  WEBHOOK — KIWIFY
//  Cole a URL no painel da Kiwify:
//  https://SEU-BACKEND.railway.app/webhook/kiwify
// ══════════════════════════════════════════
app.post('/webhook/kiwify', (req, res) => {
  try {
    const body = req.body;
    const status = body?.order_status || body?.status || '';

    const email = (
      body?.Customer?.email ||
      body?.customer?.email ||
      ''
    ).toLowerCase().trim();

    if (!email) {
      console.log('[Kiwify] Webhook sem email:', JSON.stringify(body));
      return res.status(200).json({ ok: true });
    }

    // ⚠️ ALTERE o nome do produto para bater com o seu na Kiwify
    const productName = (body?.Product?.name || body?.product_name || '').toLowerCase();

    let plan = 'mensal';
    if (productName.includes('vitalic') || productName.includes('lifetime') || productName.includes('único')) {
      plan = 'vitalicio';
    }

    if (status === 'paid' || status === 'approved' || status === 'complete') {
      activateLicense(email, plan);
      console.log(`[Kiwify] ✅ Licença ativada — ${email} | Plano: ${plan}`);
    }

    if (status === 'refunded' || status === 'canceled' || status === 'chargeback') {
      revokeLicense(email);
      console.log(`[Kiwify] ❌ Licença revogada — ${email}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Kiwify] Erro no webhook:', err.message);
    return res.status(200).json({ ok: true });
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
