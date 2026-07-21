# Multi Idle Launcher

App Electron que abre uma grade (2x2 por padrão) de sessões de navegador **isoladas** dentro de uma única janela — cada quadrante tem cookies/login independentes, então dá pra manter N contas logadas ao mesmo tempo no mesmo jogo/site.

## Rodar

```
npm install
npm start
```

## Funcionalidades

- Grade configurável: 1x1, 1x2, 2x2, 2x3, 3x3.
- Cada slot = sessão isolada (`persist:slot-N`), sem misturar login/cookies entre contas.
- Barra por slot: URL + Ir, Reload, DevTools, Script (executa JS arbitrário no contexto da página daquele slot — cole ali qualquer userscript que você já tenha, ex. os seus scripts em `rocky-idle-auto`).
- Perfis: salva/carrega o layout + URLs de cada slot em `%APPDATA%/multi-idle-launcher/profiles/*.json`.

## O que NÃO tem (de propósito)

Sem fingerprint spoofing, sem bypass de captcha, sem anti-detecção. É um "multiplicador de janelas com sessão isolada" — não um sistema pra escapar de banimento. O botão "Script" só executa o que você colar (equivalente a colar no console do DevTools); a responsabilidade de respeitar o ToS de cada jogo é de quem usa.

## Ideia de venda

Vender como ferramenta genérica de multi-conta para jogos idle/browser (não amarrar a um jogo específico no marketing — evita fricção com anti-cheat/ToS de um título só). Automação de gameplay em si (auto-click, decisão de ações) fica a critério de quem compra, via o campo de script.
