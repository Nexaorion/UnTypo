import ApiRoundedIcon from '@mui/icons-material/ApiRounded';
import Box from '@mui/material/Box';
import alibabaCloudIconUrl from '@lobehub/icons-static-svg/icons/alibabacloud-color.svg?url';
import anthropicIconUrl from '@lobehub/icons-static-svg/icons/anthropic.svg?url';
import deepSeekIconUrl from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import groqIconUrl from '@lobehub/icons-static-svg/icons/groq.svg?url';
import openAiIconUrl from '@lobehub/icons-static-svg/icons/openai.svg?url';
import openRouterIconUrl from '@lobehub/icons-static-svg/icons/openrouter-color.svg?url';
import type { ProviderIconId } from '../logic/provider-catalog.js';

const colorIconUrls: Partial<Record<ProviderIconId, string>> = {
  'alibaba-cloud': alibabaCloudIconUrl,
  deepseek: deepSeekIconUrl,
  openrouter: openRouterIconUrl,
};

const maskIconUrls: Partial<Record<ProviderIconId, string>> = {
  anthropic: anthropicIconUrl,
  groq: groqIconUrl,
  openai: openAiIconUrl,
};

export const ProviderIcon = ({
  icon,
  size = 44,
}: {
  icon: ProviderIconId;
  size?: number;
}) => {
  const colorIconUrl = colorIconUrls[icon];
  const maskIconUrl = maskIconUrls[icon];
  const glyphSize = Math.round(size * 0.56);

  return (
    <Box
      aria-hidden
      component="span"
      sx={{
        alignItems: 'center',
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '50%',
        color: 'text.primary',
        display: 'inline-flex',
        flex: 'none',
        height: size,
        justifyContent: 'center',
        width: size,
      }}
    >
      {colorIconUrl ? (
        <Box
          alt=""
          component="img"
          src={colorIconUrl}
          sx={{ display: 'block', height: glyphSize, width: glyphSize }}
        />
      ) : maskIconUrl ? (
        <Box
          component="span"
          sx={{
            WebkitMask: `url("${maskIconUrl}") center / contain no-repeat`,
            bgcolor: 'currentColor',
            display: 'block',
            height: glyphSize,
            mask: `url("${maskIconUrl}") center / contain no-repeat`,
            width: glyphSize,
          }}
        />
      ) : (
        <ApiRoundedIcon sx={{ fontSize: glyphSize }} />
      )}
    </Box>
  );
};
