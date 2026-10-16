// ============================================================
// Configuração da sincronização com o OpenStreetMap (arquivo editável).
//
// - OVERPASS_ENDPOINT: servidor público da Overpass API (uso justo: uma
//   consulta por sincronização, no máximo 1x por dia).
// - CIDADES: uma entrada por cidade (a chave é o argumento --cidade).
// - REGRAS: quais tags do OSM entram e em qual categoria do app.
//   Só tipos de local da lista abaixo são importados. Comércio genérico
//   (shop=*, serviços) fica de fora nesta primeira versão.
// ============================================================

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

export const CIDADES = {
  "governador-valadares": {
    nome: "Governador Valadares", // gravado em pontos.cidade
    area: {
      name: "Governador Valadares",
      admin_level: "8", // relação municipal no OSM
      // Filtros extras para não casar com homônimos. Confirmar no OSM antes da 1ª execução
      // (relação do município -> aba Tags). Remover a linha se a tag não existir.
      filtrosExtras: { "IBGE:GEOCODIGO": "3127701" },
    },
    timeoutSegundos: 180,
  },
};

// Ordem importa: vale a PRIMEIRA regra que casar (específicas antes de genéricas).
// Categorias possíveis: Patrimônio, Cultura, Lazer, Gastronomia, Natureza, Religião.
// valores: lista de valores aceitos da tag, ou "*" para qualquer valor.
export const REGRAS = [
  { chave: "tourism", valores: ["museum", "gallery"], categoria: "Cultura" },
  { chave: "amenity", valores: ["theatre", "arts_centre", "library"], categoria: "Cultura" },
  { chave: "amenity", valores: ["place_of_worship"], categoria: "Religião" },
  { chave: "historic", valores: "*", categoria: "Patrimônio" },
  { chave: "tourism", valores: ["viewpoint"], categoria: "Natureza" },
  { chave: "natural", valores: ["peak", "waterfall"], categoria: "Natureza" },
  { chave: "leisure", valores: ["park", "playground", "sports_centre"], categoria: "Lazer" },
  { chave: "amenity", valores: ["restaurant", "cafe", "marketplace"], categoria: "Gastronomia" },
  // D-2: tourism=attraction é a tag mais genérica, por isso fica por último entre as de
  // turismo; um elemento que também tenha historic/museum fica com a categoria específica.
  { chave: "tourism", valores: ["attraction"], categoria: "Lazer" },
  // D-1: nenhuma categoria descreve banheiro; "Lazer" é a mais neutra (equipamento de
  // praça/parque). Como elementos sem nome são ignorados, quase nenhum banheiro entra.
  { chave: "amenity", valores: ["toilets"], categoria: "Lazer" },
];
