(() => {
    const routeAliases = {
        home: 'index.html',
        'getting-started': 'getting-started.html',
        workflow: 'core-workflow.html',
        cli: 'cli-reference.html',
        api: 'daemon-api.html',
        database: 'database.html',
        deployments: 'deployment-engine.html',
        routing: 'caddy-routing.html',
        operations: 'operations.html',
        roadmap: 'roadmap.html',
    };

    const pages = [
        { path: 'index.html', title: 'Overview', text: 'mini-vercel docs current branch auth github caddy queue search' },
        { path: 'getting-started.html', title: 'Getting started', text: 'install build start daemon signup login caddy trust' },
        { path: 'core-workflow.html', title: 'Core workflow', text: 'link deploy queue caddy local hostname preview' },
        { path: 'cli-reference.html', title: 'CLI reference', text: 'start-daemon signup login logout whoami github connect oauth import caddy mode trust deploy env logs rollback' },
        { path: 'daemon-api.html', title: 'Daemon API', text: 'health queue caddy auth github projects webhook protected routes' },
        { path: 'database.html', title: 'Database', text: 'sqlite users sessions projects deployments env vars github columns owner_id' },
        { path: 'deployment-engine.html', title: 'Deployment engine', text: 'framework detection docker build port env blue green preview rollback' },
        { path: 'caddy-routing.html', title: 'Caddy routing', text: 'local public tls internal local_certs preview custom domain reload' },
        { path: 'operations.html', title: 'Operations', text: 'queue logs maintenance prune sessions deployments webhook hmac' },
        { path: 'roadmap.html', title: 'Roadmap', text: 'future not implemented dashboard resource limits dev mode multi domain plugins' },
    ];

    const currentPage = document.body.dataset.page;
    const searchInput = document.getElementById('doc-search');
    const sidebarLinks = Array.from(document.querySelectorAll('[data-nav]'));

    sidebarLinks.forEach((link) => {
        if (link.dataset.nav === currentPage) {
            link.setAttribute('aria-current', 'page');
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            sidebarLinks.forEach((link) => {
                const navKey = link.dataset.nav || '';
                const page = pages.find((item) => {
                    return item.path === routeAliases[navKey];
                });
                const haystack = `${link.textContent || ''} ${page?.title || ''} ${page?.text || ''}`.toLowerCase();
                link.classList.toggle('is-hidden', query.length > 0 && !haystack.includes(query));
            });
        });
    }
})();