import type { Metadata } from "next";
import Link from "next/link";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "Ce que TrackFleet fait vraiment — TrackFleet",
  description: "Guide de référence sur les mécaniques non-évidentes de TrackFleet : progression, relais CTM, notifications WhatsApp, confirmations et plus.",
};

export default function GuidePage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.backLink} href="/">← Retour au tableau de bord</Link>

        <header className={styles.masthead}>
          <div className={styles.mastheadEyebrow}>Manifeste interne · TrackFleet</div>
          <h1 className={styles.title}>Ce que TrackFleet fait vraiment</h1>
          <p>Le tableau de bord montre un statut simple — “En route”, “Livré”. Derrière, plusieurs minuteurs et règles décident quand ce statut change. Ce guide explique chaque mécanique non-évidente, en clair.</p>
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.manual}`} />déclenché par une personne</span>
            <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.auto}`} />déclenché automatiquement</span>
          </div>
        </header>

        <nav className={styles.index} aria-label="Sommaire">
          <a href="#progression"><span className={`${styles.indexNum} ${styles.mono}`}>01</span> La barre à 99% qui ne bouge plus</a>
          <a href="#relais"><span className={`${styles.indexNum} ${styles.mono}`}>02</span> Le relais CTM et le hub</a>
          <a href="#whatsapp"><span className={`${styles.indexNum} ${styles.mono}`}>03</span> Les deux canaux WhatsApp</a>
          <a href="#confirmation"><span className={`${styles.indexNum} ${styles.mono}`}>04</span> Deux boutons, une seule action</a>
          <a href="#estimation"><span className={`${styles.indexNum} ${styles.mono}`}>05</span> D’où vient la date d’arrivée</a>
          <a href="#alias"><span className={`${styles.indexNum} ${styles.mono}`}>06</span> Le nom du camion</a>
          <a href="#demo"><span className={`${styles.indexNum} ${styles.mono}`}>07</span> Le mode démo</a>
          <a href="#colis-lies"><span className={`${styles.indexNum} ${styles.mono}`}>08</span> Les colis liés</a>
        </nav>

        <section className={styles.entry} id="progression">
          <div className={styles.entryEyebrow}><span>01</span> · Suivi &amp; progression</div>
          <h2>Pourquoi la barre de progression reste bloquée à 99% ?</h2>
          <p>C’est volontaire. Le GPS peut dire “le camion est arrivé”, mais jamais “le colis est livré” — quelqu’un pourrait encore attendre devant l’agence fermée, ou le camion être juste de passage à proximité. Le passage à 100% attend toujours l’un des deux déclencheurs ci-dessous, jamais la seule position GPS.</p>

          <div className={styles.timeline}>
            <div className={`${styles.tlStop} ${styles.auto}`}>
              <div className={styles.tlNode}>→</div>
              <div className={styles.tlLabel}>Le camion roule, GPS en direct</div>
              <div className={styles.tlTag}>0–99%</div>
            </div>
            <div className={`${styles.tlStop} ${styles.manual}`}>
              <div className={styles.tlNode}>✓</div>
              <div className={styles.tlLabel}>Confirmation manuelle de l’arrivée</div>
              <div className={styles.tlTag}>humain</div>
            </div>
            <div className={`${styles.tlStop} ${styles.manual}`}>
              <div className={`${styles.tlNode} ${styles.mono}`}>2h</div>
              <div className={styles.tlLabel}>Délai de déchargement</div>
              <div className={styles.tlTag}>minuteur</div>
            </div>
            <div className={`${styles.tlStop} ${styles.end}`}>
              <div className={styles.tlNode}>●</div>
              <div className={styles.tlLabel}>Livré — 100%</div>
            </div>
          </div>

          <p>Pour une agence suivie par GPS jusqu’au bout, il existe un deuxième chemin, entièrement automatique : le camion s’arrête près de la destination, roule à moins de 5&nbsp;km/h, et cette position tient depuis un moment — TrackFleet en déduit l’arrivée tout seul, puis applique le même délai de 2h avant de passer à “Livré”.</p>

          <div className={`${styles.callout} ${styles.critical}`}>
            <p><strong>Ce qui ne se passe jamais :</strong> une bascule immédiate à 100% au moment où le camion touche la zone d’arrivée, ou au moment où on clique sur “Confirmer l’arrivée”. Les deux ne font que démarrer le compte à rebours de 2h.</p>
          </div>
        </section>

        <section className={styles.entry} id="relais">
          <div className={styles.entryEyebrow}><span>02</span> · Relais CTM</div>
          <h2>Pourquoi certaines agences n’ont jamais de position GPS live ?</h2>
          <p>Nos camions suivis par GPS ne roulent que jusqu’à deux points de passage confirmés : <strong>Casablanca</strong> ou le <strong>ferry de Tanger&nbsp;Med</strong>. Au-delà, c’est CTM qui prend le relais pour la dernière étape — et leurs véhicules ne remontent aucune position dans TrackFleet.</p>

          <p>Concrètement, pour une agence comme Tétouan, Salé, Marrakech, Agadir, Khouribga ou Fquih Ben Salah&nbsp;:</p>

          <div className={styles.split}>
            <div className={`${styles.panel} ${styles.auto}`}>
              <div className={styles.panelTitle}>Jusqu’au hub</div>
              <p>Position GPS réelle, carte en direct, progression normale — comme n’importe quelle livraison suivie.</p>
            </div>
            <div className={`${styles.panel} ${styles.manual}`}>
              <div className={styles.panelTitle}>Après le hub</div>
              <p>Le badge <code className={styles.code}>Relais CTM</code> apparaît, la carte s’arrête, et l’arrivée doit être confirmée — manuellement, ou automatiquement 24h après la dernière position GPS.</p>
            </div>
          </div>

          <p>Le pourcentage lui-même est calculé jusqu’au hub uniquement, pas jusqu’à l’agence finale — sinon un trajet Bruxelles→Tétouan afficherait encore 95% en plein milieu de l’Espagne, la portion CTM étant minuscule comparée au trajet européen.</p>
        </section>

        <section className={styles.entry} id="whatsapp">
          <div className={styles.entryEyebrow}><span>03</span> · Notifications</div>
          <h2>Il y a deux façons d’envoyer un WhatsApp, pas une</h2>

          <div className={styles.split}>
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Envoi automatique par modèle <span className={`${styles.badge} ${styles.off}`}>désactivé</span></div>
              <p>Le message-type payant que Meta envoie tout seul à chaque étape. Coûte de l’argent par envoi, partagé sur un seul numéro professionnel entre tous les clients Pro. Volontairement coupé pour l’instant.</p>
            </div>
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Réponse libre &amp; gratuite <span className={`${styles.badge} ${styles.on}`}>active</span></div>
              <p>Dès qu’un client écrit sur WhatsApp, une fenêtre de 24h s’ouvre où on peut répondre librement, gratuitement. C’est ce canal que “Notifier par WhatsApp” et les confirmations de départ/arrivée utilisent aujourd’hui.</p>
            </div>
          </div>

          <p>Ce que ça change en pratique&nbsp;: confirmer un départ ou une arrivée <em>tente</em> toujours d’envoyer un message, mais ça ne marche que si le client a déjà écrit dans les dernières 24h, ou s’il n’a jamais retiré son consentement. Le message de confirmation le dit honnêtement — “notifié” ou “non envoyé”, jamais l’un pour l’autre.</p>
        </section>

        <section className={styles.entry} id="confirmation">
          <div className={styles.entryEyebrow}><span>04</span> · Interface</div>
          <h2>Le tableau et le panneau “Arrivées” font la même chose</h2>
          <p>Deux endroits permettent de confirmer un départ ou une arrivée&nbsp;: les boutons directement sur la ligne du camion dans le tableau, et le panneau dédié “Arrivées et clôture”. Ce sont deux portes vers exactement la même action côté serveur — même minuteur de 2h, même tentative de notification WhatsApp.</p>
          <p>Sur un camion transportant des colis pour <strong>plusieurs agences différentes</strong>, le tableau propose un bouton “Confirmer l’arrivée” séparé par agence — cliquer sur celui de Tétouan ne touche pas les colis destinés à Tanger&nbsp;Med sur le même camion.</p>
        </section>

        <section className={styles.entry} id="estimation">
          <div className={styles.entryEyebrow}><span>05</span> · Estimation d’arrivée</div>
          <h2>D’où vient la date “arrivée estimée” à la création ?</h2>
          <p>Jamais tapée à la main — toujours calculée à partir de la date de départ et de l’agence choisie, côté serveur.</p>
          <div className={styles.split}>
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Au début</div>
              <p>Un délai fixe selon le hub&nbsp;: <span className={styles.mono}>+6&nbsp;jours</span> pour les agences via Tanger&nbsp;Med, <span className={styles.mono}>+12&nbsp;jours</span> via Casablanca — le milieu des délais annoncés par CTM.</p>
            </div>
            <div className={`${styles.panel} ${styles.auto}`}>
              <div className={styles.panelTitle}>Une fois assez d’historique</div>
              <p>Dès qu’au moins deux arrivées réelles ont été confirmées pour cette agence précise, l’estimation bascule sur la <strong>durée médiane réellement observée</strong> — plus juste que le délai générique du hub.</p>
            </div>
          </div>
        </section>

        <section className={styles.entry} id="alias">
          <div className={styles.entryEyebrow}><span>06</span> · Flotte</div>
          <h2>Renommer un camion — ça tient, partout</h2>
          <p>“Renommer ce véhicule” (sur la carte) remplace le nom brut SENDATRACK par celui choisi — dans le tableau, les messages WhatsApp, l’historique de position, et l’affectation d’un camion à une livraison. Le nom d’origine ne réapparaît jamais une fois l’alias posé.</p>
        </section>

        <section className={styles.entry} id="demo">
          <div className={styles.entryEyebrow}><span>07</span> · Démonstration</div>
          <h2>Montrer l’appli à un client sans vrai camion</h2>
          <p>“Créer une livraison démo” crée une livraison réelle marquée <code className={styles.code}>[DEMO]</code>, isolée des vraies données. Une fois créée, “Faire avancer le camion” la fait sauter par paliers (35% → 70% → 95%) le long du vrai trajet routier — pas une ligne droite sur la carte. Départ et arrivée se confirment ensuite depuis le tableau, exactement comme une vraie livraison, WhatsApp compris.</p>
          <p>“Supprimer les livraisons démo” nettoie tout d’un coup, sans toucher aux vraies livraisons.</p>
        </section>

        <section className={styles.entry} id="colis-lies">
          <div className={styles.entryEyebrow}><span>08</span> · Multi-colis</div>
          <h2>Le badge “colis liés”</h2>
          <p>Plusieurs colis créés ensemble pour un même envoi partagent un identifiant commun et affichent un badge <code className={styles.code}>N colis liés</code> dans le tableau. C’est purement un repère visuel — chaque colis garde son propre suivi, son propre statut, et peut partir sur un camion différent si besoin.</p>
        </section>

        <footer className={styles.footer}>
          TrackFleet — vérifié en conditions réelles, pas seulement dans le code.
        </footer>
      </div>
    </main>
  );
}
