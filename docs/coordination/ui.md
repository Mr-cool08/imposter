# Samordning av kategoriurval

Innehållskontraktet i `docs/content.md` skiljer mellan utelämnat `categories` (alla kategorier) och `categories: []` (inga valda kategorier). Gränssnittet skickar utelämnat fält eller utvalda kategori-ID:n som normalt startval och blockerar start vid tomt urval. Behåll skillnaden i katalogens anrop och återläsning av sparade inställningar, särskilt om onlinerummet normaliserar inställningarna före filtrering. Motorstandarden `categories: []` betyder alla ord i motorns redan filtrerade urval. Offlinepanelen behöver skilja ett utelämnat fält från ett uttryckligen tomt urval om den visar eller laddar just valda kategorier.

## Flikbyte i Chromium-testet

Playwright aktiverar fokusemulering för varje sida. Med standardinställningen utlöser `other_tab.bring_to_front()` inget `blur` på spelsidan, som fortsätter rapportera `document.hasFocus() === true`. Webbläsartestet stänger av emuleringen med CDP före flikbytet. Den kompletta offlineomgången passerar kontrollen, inklusive återgång till det dolda kortet och historiksparning.

## Gränssnittets verifiering

Lokalvyn testades i Chrome vid 320 px för avbruten bakåtnavigering och återgång från en annan sida. `pageshow.persisted` var sann och den privata vyn var fortfarande borttagen ur DOM. Vid 320, 390 och 1440 px fungerade start, inställningspanelen, språk- och temabyte, regler och lokal setup utan horisontell skroll. En riktad flerspelarkörning passerade vybyte under aktiv onlinerunda, bibehållen uppdateringsspärr och upplåsning vid resultat. Testet verifierade också att avstängd namnsparning rensade både lokal- och onlinenamn. De svenska och engelska UI-fragmenten innehåller 274 validerade nycklar vardera.
