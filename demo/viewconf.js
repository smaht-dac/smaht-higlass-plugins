const server = 'https://higlass.io/api/v1';
// hg38, same as the chromosome labels tileset below.
const chromSizesUrl = `${server}/chrom-sizes/?id=NyITQvZsS_mOFNlz5C2LJg`;
const sequenceUrl = 'https://aveit.s3.amazonaws.com/higlass/data/sequence';

export const viewConfig = {
  editable: true,
  trackSourceServers: [server],
  views: [
    {
      uid: 'demo',
      layout: { w: 12, h: 6, x: 0, y: 0 },
      initialXDomain: [0, 3100000000],
      chromInfoPath: chromSizesUrl,
      tracks: {
        top: [
          {
            uid: 'text',
            type: 'text',
            height: 30,
            options: {
              text: 'SMaHT somatic variants (hg38)',
              fontSize: 14,
              backgroundColor: '#ededed',
              textColor: '#333333',
              align: 'left',
              offsetY: 4,
            },
          },
          {
            uid: 'chroms',
            type: 'horizontal-chromosome-labels',
            height: 30,
            // A tileset is required for the genome position search box.
            server,
            tilesetUid: 'NyITQvZsS_mOFNlz5C2LJg',
          },
          {
            uid: 'somatic',
            type: 'smaht-somatic-variants',
            height: 100,
            data: {
              type: 'smaht-somatic-vcf',
              // Synthetic, see demo/data/make-synthetic-vcf.mjs
              vcfUrl: '/demo/data/synthetic-somatic.vcf.gz',
              chromSizesUrl,
              fastaUrl: `${sequenceUrl}/hg38.fa`,
              faiUrl: `${sequenceUrl}/hg38.fa.fai`,
            },
            options: { name: 'Synthetic somatic SNVs' },
          },
          {
            uid: 'genes',
            type: 'horizontal-gene-annotations',
            height: 60,
            server,
            tilesetUid: 'P0PLbQMwTYGy-5uPIQid7A',
          },
        ],
        left: [],
        center: [],
        right: [],
        bottom: [],
        whole: [],
        gallery: [],
      },
    },
  ],
};
