'use strict';
const grid=document.getElementById('grid');let activeDatasetId=null;let providerInvocations=0;
const integratedCardSurface=window.AthenaLib.IntegratedCardSurface;
const errorNote=window.AthenaLib.UiKit.errorNote;
const widthGradeFor=window.AthenaLib.CanvasLayout.widthGradeFor;
// Public DOM environment doubles; no application lifecycle, dataset service or provider.
const isValidCorrelation=value=>!!value&&typeof value.dataset_id==='string';
const freshLabel=()=>'';
const destroyCard=card=>card.remove();
const enforceHeightBudget=()=>{};
const cardCloseButton=card=>window.AthenaLib.UiKit.button('text','닫기',{onClick:()=>card.remove()});
window.athena={invoke:()=>{providerInvocations++;throw new Error('Fixture forbids invoke');}};
