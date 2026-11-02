# einarkari.github.io
Verkefnasafn Einars Kára - einarkari.com

## Hvernig vefurinn er settur saman

- **Forsíðan** (`index.html`, `assets/`, `fonts/`, `404.html` o.fl., sjá `.site-files`)
  er smíðuð úr Higgsfield-vefnum *einarkari* og flutt hingað sjálfvirkt.
  Ekki breyta þessum skrám hér í höndunum, þær eru skrifaðar yfir við næsta innflutning.
- **Verkefnin** eru í eigin möppum (`evropa/`, `idnbyltingin/`, `jarvis/`, `skolabord/`)
  og er breytt beint hér eins og áður.

## Nýtt verkefni

1. Settu verkefnið í nýja möppu hér, t.d. `nytt-verkefni/index.html`.
2. Bættu því við forsíðuna í Higgsfield-vefnum: `app/src/content/projects.ts`
   (leiðbeiningar í `app/src/content/README.md` þar). Hlekkurinn er
   `https://einarkari.com/nytt-verkefni/`.
3. Byggðu forsíðuna, settu `.tar.gz` af henni á netið og uppfærðu slóðina og
   `sha256` í `.github/site-import.json`. Workflow-ið
   `.github/workflows/import-site.yml` setur þá nýju forsíðuna inn.
