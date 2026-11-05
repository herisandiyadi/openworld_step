import { useEffect } from 'react';
import { FishingHud } from '../fishing/FishingHud';
import { useGameStore } from '../state/gameStore';
import { useContentProgress } from '../state/contentProgress';
import { updateFishing, pullFishing, cancelFishing, releaseFishingResult } from '../game/fishingActions';
import { ShopScreen } from '../economy/ShopScreen';
import { BagPanel } from '../economy/BagPanel';
import { FishStallScreen } from '../economy/FishStallScreen';
import { contentRuntime } from '../app/contentRuntime';
import { bagCapacityFor, closeEconomy, equipItemById, fishPriceOf, nearWater, sellAtNearbyStall } from '../game/economyActions';
import { JobBoard } from './JobBoard';
import { availableJobs, completeAvailableJob } from '../game/jobRuntime';

/** Bridges the existing pure screens/controllers into the live HUD. */
export function ContentOverlays({ jobBoardOpen = false, onCloseJobBoard = () => {} }: { jobBoardOpen?: boolean; onCloseJobBoard?: () => void }) {
  const fishing = useGameStore((state) => state.fishing);
  const economyScreen = useGameStore((state) => state.economyScreen);
  const activeShopId = useGameStore((state) => state.activeShopId);
  const bag = useContentProgress((state) => state.bag);
  const coins = useContentProgress((state) => state.coins);
  const inventory = useContentProgress((state) => state.inventory);
  const quests = useContentProgress((state) => state.quests);
  const jobs = useContentProgress((state) => state.jobs);
  const bonusDate = useContentProgress((state) => state.bonusDate);

  useEffect(() => {
    if (!fishing) return;
    const id = window.setInterval(() => updateFishing(Date.now()), 50);
    return () => window.clearInterval(id);
  }, [fishing]);

  const closeFishing = () => releaseFishingResult();
  const shop = activeShopId ? contentRuntime.registry?.getShop(activeShopId) : undefined;
  const shopItems = shop?.items.map((id) => contentRuntime.registry?.getItem(id)).filter((item): item is NonNullable<typeof item> => item !== undefined).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    retired: item.retired,
    ...(item.unlockAfter ? { unlockAfter: item.unlockAfter } : {}),
  })) ?? [];
  const completedQuests = quests.filter((quest) => quest.status === 'completed' || quest.completions > 0).map((quest) => quest.questId);
  const date = new Date().toISOString().slice(0, 10);
  const boardJobs = availableJobs(jobs.date === date ? jobs.date : date).map((job) => ({
    ...job,
    requirementsMet: job.questId !== null && (quests.find((quest) => quest.questId === job.questId)?.completions ?? 0) > 0,
  }));

  return (
    <>
      {jobBoardOpen && (
        <JobBoard
          jobs={boardJobs}
          bonusClaimedToday={bonusDate === date}
          onComplete={(jobId) => {
            completeAvailableJob(jobId, date);
          }}
          onClose={onCloseJobBoard}
        />
      )}
      {fishing && (
        <FishingHud
          session={fishing}
          onPull={pullFishing}
          onCancel={cancelFishing}
          onRelease={closeFishing}
        />
      )}
      {economyScreen === 'shop' && (
        <ShopScreen
          items={shopItems}
          balance={coins}
          ownedIds={inventory.owned.map((item) => item.id)}
          completedQuests={completedQuests}
          onBuy={(item) => {
            const contentItem = contentRuntime.registry?.getItem(item.id);
            if (contentItem) useContentProgress.getState().purchaseStoreItem({ id: contentItem.id, category: contentItem.category, retired: contentItem.retired, price: contentItem.price });
          }}
          onEquip={(item) => equipItemById(item.id)}
          onClose={closeEconomy}
        />
      )}
      {economyScreen === 'bag' && (
        <BagPanel
          bag={bag.capacity === bagCapacityFor() ? bag : { ...bag, capacity: bagCapacityFor() }}
          nearWater={nearWater()}
          priceOf={fishPriceOf}
          onReleaseFish={(itemId) => useContentProgress.getState().releaseOneFish(itemId, nearWater())}
          onClose={closeEconomy}
        />
      )}
      {economyScreen === 'stall' && (
        <FishStallScreen
          bag={bag}
          priceOf={fishPriceOf}
          onSell={sellAtNearbyStall}
          onClose={closeEconomy}
        />
      )}
    </>
  );
}
