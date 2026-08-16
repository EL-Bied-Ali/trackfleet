# TrackFleet — informations minimales à demander au client

Cette liste sert à éviter les allers-retours. Ne demander que les informations qui ne peuvent pas être déduites de SENDATRACK ou configurées raisonnablement par défaut.

## À obtenir avant mise en production

1. **Sites habituels de départ / arrivée**
   - Nom du site
   - Adresse exacte ou coordonnées GPS
   - Si plusieurs entrées existent, point GPS correspondant à l'entrée réellement utilisée par les camions

2. **Définition métier de « arrivé »**
   - Par défaut TrackFleet considère l'arrivée quand le camion est dans la géofence et pratiquement à l'arrêt.
   - Confirmer si le client veut plutôt : entrée sur le site, arrivée au quai, ou fin de déchargement.

3. **Destinataires des notifications**
   - Numéro WhatsApp du contact de livraison, idéalement fourni avec chaque dossier.
   - Confirmer si un même dossier peut avoir plusieurs destinataires.

4. **Notifications souhaitées**
   - Valeur par défaut proposée : départ, 25 %, 50 %, 75 %, proche destination, arrivée.
   - Ne demander une personnalisation que si le client ne veut pas ce comportement.

## Utile mais non bloquant

- Fenêtre d'arrivée planifiée (date + plage horaire), plutôt qu'une heure seule.
- Rayon de géofence spécifique pour les très grands sites. Défaut TrackFleet : 500 m.
- Niveau de précision GPS autorisé sur le lien public client.
- Durée pendant laquelle le lien de suivi reste accessible après livraison.
- Langue préférée des messages client.

## À ne pas demander au client si SENDATRACK le fournit

- Position GPS courante
- Vitesse
- Timestamp de dernière position
- Identifiant GPS / véhicule
- Direction / heading lorsqu'elle est disponible

## Principe produit

Tout élément non fourni doit avoir une valeur par défaut sûre et modifiable. L'absence d'une information optionnelle ne doit pas empêcher la création ou le suivi d'une livraison.
