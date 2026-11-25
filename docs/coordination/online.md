# Integration för onlinespel

Online använder `storage`-nyckeln `onlineName` endast när namnminnet är aktiverat. Skalets inställningar behöver rensa även `storage.remove("onlineName")` när namnminnet avaktiveras och när sparade namn rensas, parallellt med befintlig rensning av `localPlayers` i `app/static/js/ui.mjs`. Online rensar dessutom sitt sparade namn när vyn monteras med namnminnet avstängt.
