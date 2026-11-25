# Fritt lokalspel i gränssnittet

Startsidan visar spelinställningarna direkt. Appval ligger i `#preferences-menu`. Där öppnar `#offline-menu > summary` nedladdningspanelen och `#open-word-tools` öppnar egna ordpaket. Pakethanteringen är en del av inställningarna och har ingen separat URL. Sidhuvudets verktyg är dolda under handoff, spel och avslöjande.

Testpunkter är `local-setup`, `local-player-name`, `local-add-player`, `local-start`, `local-handoff`, `local-show-private`, `local-private-content`, `local-hide-card`, `local-show-roles`, `local-result` och `local-next-round` som `data-testid`. Omgångsflödet använder motorvalet `{flow: "table"}`. Inga gamla steg exponeras i gränssnittet.

Offlinepanelen behöver filtrera bort egna paket-ID:n med `getCustomContent().categories` från `extras.mjs`. Lagringsnyckeln `customPack` motsvarar ingen källa i den nuvarande redigeraren. Panelen kan då även visa skalberedskap för ett urval med enbart egna ord.

Playwright söker relativt den yttre raden i `filter(has=...)`. Använd en sidbaserad radhuvudlocator för att matcha en resultatspelare, exempelvis `row.filter(has=page.get_by_role("rowheader", name=name, exact=True))`. En radhuvudlocator byggd från hela resultatområdet försöker hitta resultatområdet på nytt inuti raden.
