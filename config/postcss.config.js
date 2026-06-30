const purgecss = require('@fullhuman/postcss-purgecss');
const whitelister = require('purgecss-whitelister');

module.exports = {
    plugins: [
        purgecss({
            content: ['./hugo_stats.json'],
            extractors: [
                {
                    extractor: (content) => {
                        const els = JSON.parse(content).htmlElements;
                        return els.tags.concat(els.classes, els.ids);
                    },
                    extensions: ['json']
                }
            ],
            dynamicAttributes: [
                'aria-expanded',
                'data-bs-popper',
                'data-bs-target',
                'data-bs-theme',
                'data-dark-mode',
                'data-global-alert',
                'data-pane',
                'data-popper-placement',
                'data-sizes',
                'data-toggle-tab',
                'id',
                'size',
                'type'
            ],
            safelist: [
                'active',
                'btn-clipboard',
                'clipboard',
                'disabled',
                'hidden',
                'modal-backdrop',
                'selected',
                'show',
                'img-fluid',
                'blur-up',
                'lazyload',
                'lazyloaded',
                'alert-link',
                'container-fw ',
                'container-lg',
                'container-fluid',
                'offcanvas-backdrop',
                'figcaption',
                'dt',
                'dd',
                'showing',
                'hiding',
                'page-item',
                'page-link',
                'not-content',
                ...whitelister(['./assets/scss/**/*.scss', './node_modules/@thulite/doks-core/assets/scss/components/_code.scss', './node_modules/@thulite/doks-core/assets/scss/components/_expressive-code.scss', './node_modules/@thulite/doks-core/assets/scss/common/_syntax.scss'])
            ]
        })
    ]
};
