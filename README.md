# Instagram Analytics Dashboard

Dashboard pessoal para acompanhar métricas do Instagram usando a Meta Graph API v25.0, com deploy na Vercel.

**URL:** https://dan-analytics.vercel.app

---

## Renovar o Access Token

O token da Meta Graph API expira periodicamente (~60 dias). Quando as requisições começarem a falhar com erro `190` (token expirado), siga os passos abaixo.

### 1. Gerar novo token

Acesse o **Graph API Explorer**:
👉 **https://developers.facebook.com/tools/explorer/**

- Selecione o app correto no canto superior direito
- Em **"User or Page"**, selecione seu usuário
- Clique em **"Generate Access Token"**
- Marque as permissões necessárias:
  - `instagram_basic`
  - `instagram_manage_insights`
  - `pages_read_engagement`
  - `pages_show_list`
- Copie o token gerado (começa com `EAA...`)

### 2. Atualizar no Vercel

Execute no terminal (na pasta do projeto):

```bash
vercel env rm ACCESS_TOKEN production --yes
printf 'SEU_TOKEN_AQUI' | vercel env add ACCESS_TOKEN production
vercel --prod
```

Ou use o comando do Claude Code:

```
/renovar-token
```

---

## Variáveis de ambiente (Vercel)

| Variável | Descrição |
|---|---|
| `ACCESS_TOKEN` | Token da Meta Graph API |
| `IG_USER_ID` | ID do usuário do Instagram |
| `GROQ_API_KEY` | Chave da API Groq (títulos com IA) |
| `DASHBOARD_PASSWORD` | Senha de acesso ao dashboard |

---

## Estrutura do projeto

```
├── index.html          # Frontend (SPA)
├── vercel.json         # Config Vercel
├── package.json        # type: module
├── dashboard.js        # Servidor local (dev)
└── api/
    ├── _lib.js         # Funções compartilhadas
    ├── account.js      # GET /api/account
    ├── insights.js     # GET /api/insights
    └── media.js        # GET /api/media
```

---

## Rodar localmente

```bash
ACCESS_TOKEN=seu_token node dashboard.js
```

Acesse: http://localhost:3333
