# Integration för onlinespel

Online använder `storage`-nyckeln `onlineName` endast när namnminnet är aktiverat. Skalet rensar nyckeln när namnminnet avaktiveras eller sparade namn rensas. Online rensar dessutom sitt sparade namn när vyn monteras med namnminnet avstängt.

Klienten döljer rollkortet vid navigering och behåller anslutningen under en aktiv onlineomgång. Skalet registrerar onlineomgångens status även medan en annan vy är öppen och skjuter upp PWA-uppdatering till mellan omgångar. Vid navigering från lobby eller resultat kopplas transporten från, med spelartoken kvar för nästa besök i vyn.

Den samlade onlinekörningen med Python 3.14.7 och Playwright i Chrome gav 12 godkända tester, inklusive samtidig röstning, dold Chaos-gissning, omladdning och en hel omgång över WebSocket. Separata Chrome-körningar verifierade engelskt gränssnitt, textläge på mobil, inställnings- och paketval samt aktiv omgång vid navigering. Lobbyn inspekterades vid 375 × 667 och 1440 × 900.
