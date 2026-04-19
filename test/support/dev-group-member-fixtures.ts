import { Position } from '@prisma/client';

export interface DevGroupMemberFixture {
  nickname: string;
  email: string;
  primaryPosition: Position;
  secondaryPosition: Position;
  overallPower: number;
  lanePower: Record<string, number>;
}

const lanePower = (
  top: number,
  jungle: number,
  mid: number,
  adc: number,
  support: number,
): Record<string, number> => ({
  [Position.TOP]: top,
  [Position.JUNGLE]: jungle,
  [Position.MID]: mid,
  [Position.ADC]: adc,
  [Position.SUPPORT]: support,
});

export const DEV_GROUP_MEMBER_FIXTURES: DevGroupMemberFixture[] = [
  {
    nickname: 'aaa33',
    email: 'dev_mock_aaa33@inhouse.local',
    primaryPosition: Position.MID,
    secondaryPosition: Position.SUPPORT,
    overallPower: 69,
    lanePower: lanePower(61, 64, 72, 63, 66),
  },
  {
    nickname: '탑현',
    email: 'dev_mock_top_hyeon@inhouse.local',
    primaryPosition: Position.TOP,
    secondaryPosition: Position.JUNGLE,
    overallPower: 67,
    lanePower: lanePower(73, 64, 58, 55, 54),
  },
  {
    nickname: '정글민',
    email: 'dev_mock_jungle_min@inhouse.local',
    primaryPosition: Position.JUNGLE,
    secondaryPosition: Position.TOP,
    overallPower: 70,
    lanePower: lanePower(61, 75, 63, 58, 60),
  },
  {
    nickname: '미드수',
    email: 'dev_mock_mid_su@inhouse.local',
    primaryPosition: Position.MID,
    secondaryPosition: Position.ADC,
    overallPower: 71,
    lanePower: lanePower(58, 61, 76, 68, 57),
  },
  {
    nickname: '원딜준',
    email: 'dev_mock_adc_jun@inhouse.local',
    primaryPosition: Position.ADC,
    secondaryPosition: Position.MID,
    overallPower: 68,
    lanePower: lanePower(55, 57, 64, 74, 58),
  },
  {
    nickname: '서폿호',
    email: 'dev_mock_support_ho@inhouse.local',
    primaryPosition: Position.SUPPORT,
    secondaryPosition: Position.ADC,
    overallPower: 66,
    lanePower: lanePower(52, 56, 58, 63, 73),
  },
  {
    nickname: '탑영',
    email: 'dev_mock_top_yeong@inhouse.local',
    primaryPosition: Position.TOP,
    secondaryPosition: Position.MID,
    overallPower: 65,
    lanePower: lanePower(71, 59, 60, 54, 53),
  },
  {
    nickname: '정글아',
    email: 'dev_mock_jungle_a@inhouse.local',
    primaryPosition: Position.JUNGLE,
    secondaryPosition: Position.SUPPORT,
    overallPower: 69,
    lanePower: lanePower(57, 74, 62, 59, 64),
  },
  {
    nickname: '원딜람',
    email: 'dev_mock_adc_ram@inhouse.local',
    primaryPosition: Position.ADC,
    secondaryPosition: Position.SUPPORT,
    overallPower: 67,
    lanePower: lanePower(54, 56, 61, 73, 60),
  },
  {
    nickname: '서폿빈',
    email: 'dev_mock_support_bin@inhouse.local',
    primaryPosition: Position.SUPPORT,
    secondaryPosition: Position.JUNGLE,
    overallPower: 68,
    lanePower: lanePower(53, 60, 57, 62, 74),
  },
];
