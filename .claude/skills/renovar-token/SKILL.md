---
name: renovar-token
description: >
  Renova ou atualiza o Access Token da Meta Graph API para o dashboard de analytics do Instagram.
  Use SEMPRE que o usuário mencionar "renovar token", "token expirou", "token inválido",
  "erro 190", "regenerar token", "adicionar novo token", "atualizar token",
  ou quando o usuário colar uma string que começa com "EAA" (formato do token da Meta).
  Também aciona quando o dashboard retorna erro de autenticação da Meta API.
  Se o usuário já forneceu o token na mensagem, vá direto para o Passo 2.
---

# Renovar Token — Meta Graph API

O token da Meta Graph API expira a cada ~60 dias. Quando expirar, o dashboard retorna erro `190: Error validating access token`.

## Passo 1 — Gerar o novo token (só se o usuário ainda não forneceu)

Se o usuário **já colou um token** (começa com `EAA`), **pule direto para o Passo 2**.

Se ainda não tiver o token, mande este link:

👉 **https://developers.facebook.com/tools/explorer/**

Instruções no Graph API Explorer:
1. Selecione o **App** correto no canto superior direito
2. Em **"User or Page"**, selecione seu usuário
3. Clique em **"Generate Access Token"**
4. Marque as permissões:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_read_engagement`
   - `pages_show_list`
5. Autorize e copie o token gerado (começa com `EAA...`)

Quando tiver o token, cole aqui.

## Passo 2 — Atualizar na Vercel e fazer deploy

Quando o token estiver disponível (começa com `EAA`), execute os três comandos abaixo **em sequência** na pasta `/Users/danvitoriano/development/dan-analytics`:

```bash
vercel env rm ACCESS_TOKEN production --yes
```

```bash
printf 'TOKEN_AQUI' | vercel env add ACCESS_TOKEN production
```
> ⚠️ Use `printf` (não `echo` nem `<<<`) para evitar `\n` invisível no final que causa falha silenciosa na autenticação.

```bash
vercel --prod
```

## Passo 3 — Verificar

Após o deploy, teste se o token está funcionando:

```bash
curl -s https://dan-analytics.vercel.app/api/account -H "x-password: 9832" | head -c 80
```

- ✅ Sucesso: retorna `{"username":"danvitoriano",...}`
- ❌ Falha: retorna `{"error":"..."}` — peça ao usuário para gerar um novo token no Explorer

Informe o resultado ao usuário de forma clara.
