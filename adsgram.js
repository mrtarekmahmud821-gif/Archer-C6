const ADSGRAM_BLOCK_ID = "YOUR_ADSGRAM_BLOCK_ID";

let adController = null;

function getAdController() {
  if (!window.Adsgram) {
    throw new Error("Adsgram SDK লোড হয়নি।");
  }

  if (!adController) {
    adController = window.Adsgram.init({
      blockId: ADSGRAM_BLOCK_ID
    });
  }

  return adController;
}

export async function showRewardedAd() {
  const tg = window.Telegram?.WebApp;

  if (!tg?.initData) {
    throw new Error("Telegram-এর ভেতর থেকে অ্যাপটি খুলুন।");
  }

  const controller = getAdController();

  try {
    await controller.show();

    // Callback মানেই server-verified reward নয়।
    // Reward URL / server verification সম্পন্ন না হওয়া পর্যন্ত
    // এখানে balance পরিবর্তন করা যাবে না।

    return {
      completed: true,
      message: "বিজ্ঞাপন সম্পন্ন হয়েছে। রিওয়ার্ড যাচাই হচ্ছে।"
    };
  } catch (error) {
    return {
      completed: false,
      message: "বিজ্ঞাপন সম্পন্ন হয়নি। পয়েন্ট দেওয়া হয়নি।"
    };
  }
}
