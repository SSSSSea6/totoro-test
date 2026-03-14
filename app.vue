<script setup lang="ts">
// import '@unocss/reset/tailwind.css';

const appConfig = useAppConfig();

useHead({
  title: '龙猫乐园',
  link: [
    { rel: 'dns-prefetch', href: '//app.xtotoro.com' },
    { rel: 'dns-prefetch', href: '//open.weixin.qq.com' },
    { rel: 'dns-prefetch', href: '//long.open.weixin.qq.com' },
    { rel: 'dns-prefetch', href: '//webapi.amap.com' },
    { rel: 'preconnect', href: 'https://app.xtotoro.com', crossorigin: '' },
    { rel: 'preconnect', href: 'https://open.weixin.qq.com', crossorigin: '' },
    { rel: 'preconnect', href: 'https://long.open.weixin.qq.com', crossorigin: '' },
  ],
});

</script>
<script lang="ts">
window.global = window;
</script>
<template>
  <VApp>
    <VMain>
      <div class="p-4">
        <NuxtPage />
        <!--p class="mt-4 text-xs">
          Powered by totoro-paradise v{{ appConfig.version }}
        </p> -->
      </div>
    </VMain>
  </VApp>
</template>

<style>
.btn-click-locked {
  opacity: 0.45 !important;
  filter: grayscale(0.9);
  pointer-events: none !important;
  transition: opacity 0.08s linear;
}
</style>
